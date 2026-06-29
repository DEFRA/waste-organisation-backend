import { randomUUID } from 'node:crypto'
import { paths } from '../config/paths.js'
import { config } from '../config.js'
import { paymentSchema, initiatePayment, updateFromGovPayEvent, hasStatusChanged, isFailed, isRefunded, isPaid } from '../domain/payment.js'
import { paymentCollection, findMatchingPayments, createStubPayment, deleteStubPayment } from '../repositories/payment.js'
import { orgCollection } from '../repositories/organisation.js'
import { updateOrganisationPaymentStatus, updateDisableAfter } from '../domain/organisation.js'
import { updateWithOptimisticLock } from '../repositories/index.js'
import { apiKeyAuthStrategy } from '../plugins/auth.js'
import { addVersionField, swaggerResponse } from './swagger-common.js'
import { createGovPayPayment, getPaymentStatus } from '../services/govPay/index.js'
import boom from '@hapi/boom'
import { sendSqsMessage } from '../plugins/sqs.js'

const createPaymentReference = ({ servicePeriodStart, servicePeriodEnd, organisationId }) => {
  const start = new Date(servicePeriodStart).getFullYear()
  const end = new Date(servicePeriodEnd).getFullYear()
  return `DWT-${start}/${end}-${organisationId}`.toUpperCase()
}

const updatePaymentStatus = async (paymentId, organisationId, govPayment, db) => {
  let shouldUpdateOrg = false
  const payment = await updateWithOptimisticLock(db.collection(paymentCollection), { paymentId, organisationId }, (dbPayment) => {
    if (dbPayment.status) {
      const p = updateFromGovPayEvent(dbPayment, govPayment)
      shouldUpdateOrg = hasStatusChanged(dbPayment, p)
      return p
    } else {
      throw boom.notFound()
    }
  })
  if (shouldUpdateOrg) {
    await updateWithOptimisticLock(db.collection(orgCollection), { organisationId }, (org) => updateOrganisationPaymentStatus(org, payment))
  }
  return payment
}

const schedulePollingTask = async (request, jobData) => {
  request.logger.debug(`Scheduling polling task: ${JSON.stringify(jobData)}`)
  return await sendSqsMessage(jobData, 'poll_for_payment', request.backgroundProcessSqsQueueUrl, request.logger, request.sqsClient)
}

const removeOldPayments = (now) => {
  const anHourAgo = new Date(now.getTime() - config.get('govPay.pendingCreatePaymentTimeout'))
  return (p) => !isFailed(p) && !isRefunded(p) && (isPaid(p) || p.createdAt == null || p.createdAt > anHourAgo)
}

export const idempontentlyInitiatePayment = async (createPayment, findPayments, deletePayment, createGovPayment, savePayment, now, log) => {
  const idempotencyKey = randomUUID()
  await createPayment(idempotencyKey)
  const foundPayments = (await findPayments())?.filter(removeOldPayments(now))
  if (foundPayments.length > 1) {
    const msg = `Found Payments during idempontentlyInitiatePayment (orgId - ${foundPayments[0].organisationId})`
    log.info(`${msg}: ${foundPayments.map((p) => [p._id, p.idempotencyKey, p.paymentId, p.status, p.createAt]).join(' ')}`)
    await deletePayment(idempotencyKey)
    return { message: 'duplicate payment' }
  }
  const { payload, status, statusCode } = await createGovPayment(idempotencyKey)
  if (status === 'success') {
    const payment = await savePayment(idempotencyKey, payload.payment_id, payload._links)
    return { message: 'success', payment }
  } else {
    await deletePayment(idempotencyKey)
    return { message: 'error', payload, statusCode, status }
  }
}

export const payments = [
  {
    method: 'GET',
    path: paths.payment,
    options: { auth: apiKeyAuthStrategy, tags: ['api'], response: { schema: swaggerResponse({ payment: addVersionField(paymentSchema) }), sample: 0 } },
    handler: async (request, h) => {
      const payment = await request.db
        .collection(paymentCollection)
        .findOne({ paymentId: request.params.paymentId, organisationId: request.params.organisationId })
      delete payment._id
      return h.response({ message: 'success', payment })
    }
  },
  {
    method: 'PUT',
    path: paths.payment,
    options: { auth: apiKeyAuthStrategy, tags: ['api'], response: { schema: swaggerResponse({ payment: addVersionField(paymentSchema) }), sample: 0 } },
    handler: async (request, h) => {
      const { paymentId, organisationId } = request.params
      const payment = await updatePaymentStatus(paymentId, organisationId, request.payload.payment, request.db)
      return h.response({ message: 'success', payment })
    }
  },
  {
    method: 'POST',
    path: paths.payment,
    options: { auth: apiKeyAuthStrategy, tags: ['api'], response: { schema: swaggerResponse({ payment: addVersionField(paymentSchema) }), sample: 0 } },
    handler: async (request, h) => {
      const { paymentId, organisationId } = request.params
      const govPayment = await getPaymentStatus(paymentId, request.logger)
      if (govPayment.status === 'success') {
        const payment = await updatePaymentStatus(paymentId, organisationId, govPayment.payload, request.db)
        return h.response({ message: 'success', payment })
      } else {
        return h.response({ message: 'error', error: govPayment })
      }
    }
  },
  {
    method: 'POST',
    path: paths.initiatePayment,
    options: { auth: apiKeyAuthStrategy, tags: ['api'], response: { schema: swaggerResponse({ payment: addVersionField(paymentSchema) }), sample: 0 } },
    handler: async (request, h) => {
      const { organisationId } = request.params
      const { amount, description, returnUrl, metadata } = request.payload.payment
      if (metadata?.organisationId !== organisationId) {
        throw boom.forbidden(`wrong organisationId in metadata: ${metadata?.organisationId} !== ${organisationId}`)
      }

      const servicePeriodStart = new Date(metadata.servicePeriodStart)
      const servicePeriodEnd = new Date(metadata.servicePeriodEnd)
      const period = `${servicePeriodStart.getFullYear()}/${servicePeriodEnd.getFullYear()}`
      const reference = createPaymentReference(metadata)
      const initiatedAt = new Date(request.info.recieved)

      const result = await idempontentlyInitiatePayment(
        async (idempotencyKey) => await createStubPayment(request.db, organisationId, period, idempotencyKey),
        async () => await findMatchingPayments(request.db, organisationId, period),
        async (idempotencyKey) => await deleteStubPayment(request.db, organisationId, idempotencyKey),
        async (idempotencyKey) => await createGovPayPayment({ reference, amount, description, returnUrl, metadata, idempotencyKey }, request.logger),
        async (idempotencyKey, paymentId, govPayLinks) => {
          const payment = await updateWithOptimisticLock(request.db.collection(paymentCollection), { idempotencyKey, organisationId }, (dbPayment) => {
            return initiatePayment({ ...dbPayment, paymentId, amount, description, returnUrl, metadata, reference, govPayLinks })
          })
          await updateWithOptimisticLock(request.db.collection(orgCollection), { organisationId }, updateDisableAfter)
          await schedulePollingTask(request, { paymentId, organisationId, traceId: request.getTraceId(), initiatedAt })
          return payment
        },
        initiatedAt,
        request.logger
      )
      if (result.message !== 'error') {
        return h.response(result)
      } else {
        const { payload, status, statusCode, message } = result
        request.logger.error(`Error contacting GovPay: ${message}, ${status}, ${statusCode}, ${JSON.stringify(payload, null, 4)}`)
        const r = {
          message: 'error',
          errors: [message, payload?.description, payload?.message, payload?.detail, statusCode ? `GovPay returned status ${statusCode}` : null]
            .filter((x) => x)
            .map((x) => ({
              message: x
            }))
        }
        return h.response(r)
      }
    }
  }
]

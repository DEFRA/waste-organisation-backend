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
import { setTimeout } from 'timers/promises'

const createPaymentReference = ({ servicePeriodStart, servicePeriodEnd, organisationId }) => {
  const start = new Date(servicePeriodStart).getFullYear()
  const end = new Date(servicePeriodEnd).getFullYear()
  return `DWT-${start}/${end}-${organisationId}`.toUpperCase()
}

const updatePaymentStatus = async (paymentId, organisationId, govPayment, db, logger) => {
  let shouldUpdateOrg = false
  const payment = await updateWithOptimisticLock(db.collection(paymentCollection), { paymentId, organisationId }, (dbPayment) => {
    if (dbPayment.status) {
      const p = updateFromGovPayEvent(dbPayment, govPayment, logger)
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

export const schedulePollingTask = async (request, jobData) => {
  request.logger.debug(`Scheduling polling task: ${JSON.stringify(jobData)}`)
  // prettier-ignore
  for (let i = 0; i < 5; i++) { // nosonar
    try {
      await setTimeout(i * config.get('govPay.schedulingPollingTaskRetrySleepStep'))
      return await sendSqsMessage(jobData, 'poll_for_payment', request.backgroundProcessSqsQueueUrl, request.logger, request.sqsClient)
    } catch (e) {
      request.logger.debug(`Scheduling polling task failed retrying (${i}): ${e}`)
    }
  }
  return null
}

const removeOldPayments = (now) => {
  const anHourAgo = new Date(now.getTime() - config.get('govPay.pendingCreatePaymentTimeout'))
  return (p) => !isFailed(p) && !isRefunded(p) && (isPaid(p) || p.createdAt == null || p.createdAt > anHourAgo)
}

export const idempontentlyInitiatePayment = async (createPayment, findPayments, deletePayment, createGovPayment, savePayment, now, log) => {
  const idempotencyKey = randomUUID()
  log.info(`creating payment with idempotencyKey ${idempotencyKey}`)
  const stub = await createPayment(idempotencyKey)
  log.info(`created payment ${JSON.stringify(stub)}`)
  const foundPayments = (await findPayments())?.filter(removeOldPayments(now))
  log.info(`payments found in the db - count ${foundPayments.length}`)
  if (foundPayments.length === 0) {
    log.error(`no payments found in the db ${stub}`)
    throw new Error('Cannot create stub payment')
  }
  const msg = `Found Payments during idempontentlyInitiatePayment (orgId - ${foundPayments[0].organisationId})`
  log.info(`${msg}: ${foundPayments.map((p) => [p._id, p.idempotencyKey, p.paymentId, p.status, p.createAt]).join(' ')}`)
  if (foundPayments.length > 1) {
    await deletePayment(idempotencyKey)
    return { message: 'duplicate payment', payment: { paymentId: foundPayments[0].paymentId } }
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
      const payment = await updatePaymentStatus(paymentId, organisationId, request.payload.payment, request.db, request.logger)
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
        const payment = await updatePaymentStatus(paymentId, organisationId, govPayment.payload, request.db, request.logger)
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
      try {
        const { organisationId } = request.params
        const { amount, description, returnUrl, metadata, language } = request.payload.payment
        const govPayLanguage = typeof language === 'string' && language.toLowerCase() === 'cy' ? 'cy' : 'en'
        if (metadata?.organisationId !== organisationId) {
          throw boom.forbidden(`wrong organisationId in metadata: ${metadata?.organisationId} !== ${organisationId}`)
        }

        const servicePeriodStart = new Date(metadata.servicePeriodStart)
        const servicePeriodEnd = new Date(metadata.servicePeriodEnd)
        const period = `${servicePeriodStart.getFullYear()}/${servicePeriodEnd.getFullYear()}`
        const reference = createPaymentReference(metadata)
        const initiatedAt = new Date(request.info.received)

        request.logger.info(`trying to initiate payment for org ${organisationId}, period ${period} -- ${initiatedAt}`)
        const result = await idempontentlyInitiatePayment(
          async (idempotencyKey) => await createStubPayment(request.db, organisationId, period, idempotencyKey),
          async () => await findMatchingPayments(request.db, organisationId, period),
          async (idempotencyKey) => await deleteStubPayment(request.db, organisationId, idempotencyKey),
          async (idempotencyKey) =>
            await createGovPayPayment({ reference, amount, description, returnUrl, metadata, idempotencyKey, language: govPayLanguage }, request.logger),
          async (idempotencyKey, paymentId, govPayLinks) => {
            const payment = await updateWithOptimisticLock(request.db.collection(paymentCollection), { idempotencyKey, organisationId }, (dbPayment) => {
              return initiatePayment({ ...dbPayment, paymentId, amount, description, returnUrl, metadata, reference, govPayLinks })
            })
            await updateWithOptimisticLock(request.db.collection(orgCollection), { organisationId }, updateDisableAfter)
            schedulePollingTask(request, { paymentId, organisationId, traceId: request.getTraceId(), initiatedAt })
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
      } catch (e) {
        request.logger.error(`error initiating payment ${e} - ${e.stack}`)
        throw e
      }
    }
  }
]

// import Boom from '@hapi/boom'
import { paths } from '../config/paths.js'
import { paymentSchema, initiatePayment, updateFromGovPayEvent, hasStatusChanged } from '../domain/payment.js'
import { paymentCollection } from '../repositories/payment.js'
import { orgCollection } from '../repositories/organisation.js'
import { updateOrganisationPaymentStatus, updateDisableAfter } from '../domain/organisation.js'
import { updateWithOptimisticLock } from '../repositories/index.js'
import { apiKeyAuthStrategy } from '../plugins/auth.js'
import { addVersionField, swaggerResponse } from './swagger-common.js'
import { createGovPayPayment, getPaymentStatus } from '../services/govPay/index.js'
import boom from '@hapi/boom'
import { randomUUID } from 'node:crypto'
import { sendSqsMessage } from '../plugins/sqs.js'

const uuidToBase36 = (uuid) => {
  const hex = uuid.replaceAll('-', '')
  const decimal = BigInt('0x' + hex)
  return decimal.toString(36) // nosonar
}

const createPaymentReference = ({ servicePeriodStart, servicePeriodEnd }) => `WASTE-${servicePeriodStart}-${servicePeriodEnd}-${uuidToBase36(randomUUID())}`

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

      const reference = createPaymentReference(metadata)
      const { payload, status, statusCode } = await createGovPayPayment({ reference, amount, description, returnUrl, metadata }, request.logger)
      if (status === 'success') {
        const payment = await updateWithOptimisticLock(
          request.db.collection(paymentCollection),
          { paymentId: payload.payment_id, organisationId: request.params.organisationId },
          (_dbPayment) => {
            return initiatePayment({
              organisationId,
              paymentId: payload.payment_id,
              amount,
              description,
              returnUrl,
              metadata,
              reference,
              govPayLinks: payload._links
            })
          }
        )
        await updateWithOptimisticLock(request.db.collection(orgCollection), { organisationId }, updateDisableAfter)
        await schedulePollingTask(request, { paymentId: payload.payment_id, organisationId, traceId: request.getTraceId(), initiatedAt: new Date() })
        return h.response({ message: 'success', payment })
      } else {
        const message = payload?.description ?? payload?.message ?? payload?.detail ?? `GovPay returned status ${statusCode}`
        request.logger.error(`Error contacting GovPay: ${status}, ${statusCode}, ${JSON.stringify(payload, null, 4)}`)
        const r = {
          message: 'error',
          errors: [{ message }]
        }
        return h.response(r)
      }
    }
  }
]

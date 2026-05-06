// import Boom from '@hapi/boom'
import { paths } from '../config/paths.js'
import { paymentSchema, initiatePayment } from '../domain/payment.js'
import { mergeAndValidate } from '../domain/index.js'
import { paymentCollection } from '../repositories/payment.js'
import { updateWithOptimisticLock } from '../repositories/index.js'
import { apiKeyAuthStrategy } from '../plugins/auth.js'
import { addVersionField, swaggerResponse } from './swagger-common.js'
import { createGovPayPayment } from '../services/govPay/index.js'
import boom from '@hapi/boom'
// swagger import { getPaymentsResponseSchema, putPaymentResponseSchema } from './schemas/payment.js'
// DONE authentication - pre-shared key?

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
      try {
        const payment = await updateWithOptimisticLock(
          request.db.collection(paymentCollection),
          { paymentId: request.params.paymentId, organisationId: request.params.organisationId },
          (dbPayment) => {
            const paymentId = request.params.paymentId
            const organisationId = request.params.organisationId
            return mergeAndValidate(
              dbPayment,
              {
                paymentId,
                organisationId,
                ...request?.payload?.payment
              },
              paymentSchema
            )
          }
        )
        return h.response({ message: 'success', payment })
      } catch (e) {
        return h.response({
          message: 'error',
          errors: e.isJoi ? e.details : [`${e}`]
        })
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
      const { payload, status, statusCode } = await createGovPayPayment({ amount, description, returnUrl, metadata }, console)
      if (status === 'success') {
        const payment = await updateWithOptimisticLock(
          request.db.collection(paymentCollection),
          { paymentId: payload.payment_id, organisationId: request.params.organisationId },
          (_dbPayment) => {
            return initiatePayment(organisationId, payload.payment_id, amount, description, returnUrl, metadata)
          }
        )
        console.log('fish: ', JSON.stringify(payment, null, 4))
        return h.response({ message: 'success', payment })
      } else {
        const message = payload?.description ?? payload?.message ?? payload?.detail ?? `GovPay returned status ${statusCode}`
        request.logger.error(`Error contacting GovPay ${status}, ${payload}`)
        const r = {
          message: 'error',
          errors: [{ message }]
        }
        return h.response(r)
      }
    }
  }
]

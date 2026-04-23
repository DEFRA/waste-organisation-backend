// import Boom from '@hapi/boom'
import { paths } from '../config/paths.js'
import { paymentSchema } from '../domain/payment.js'
import { mergeAndValidate } from '../domain/index.js'
import { paymentCollection } from '../repositories/payment.js'
import { updateWithOptimisticLock } from '../repositories/index.js'
import { apiKeyAuthStrategy } from '../plugins/auth.js'
import { addVersionField, response } from './swagger-common.js'
// swagger import { getPaymentsResponseSchema, putPaymentResponseSchema } from './schemas/payment.js'
// DONE authentication - pre-shared key?

export const payments = [
  {
    method: 'GET',
    path: paths.payment,
    options: { auth: apiKeyAuthStrategy, tags: ['api'], response: { schema: response({ payment: addVersionField(paymentSchema) }), sample: 0 } },
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
    options: { auth: apiKeyAuthStrategy, tags: ['api'], response: { schema: response({ payment: addVersionField(paymentSchema) }), sample: 0 } },
    handler: async (request, h) => {
      try {
        const payment = await updateWithOptimisticLock(
          request.db.collection(paymentCollection),
          { paymentId: request.params.paymentId, organisationId: request.params.organisationId },
          (dbPayment) => {
            const paymentId = request.params.paymentId
            const organisationId = request.params.organisationId
            const payment = mergeAndValidate(
              dbPayment,
              {
                paymentId,
                organisationId,
                ...request?.payload?.payment
              },
              paymentSchema
            )
            return payment
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
  }
]

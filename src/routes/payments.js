// import Boom from '@hapi/boom'
import { paths } from '../config/paths.js'
import { paymentSchema, initiatePayment, updateFromGovPayEvent, isPaid, hasStatusChanged } from '../domain/payment.js'
import { paymentCollection } from '../repositories/payment.js'
import { orgCollection } from '../repositories/organisation.js'
import { enableOrg, disableOrg } from '../domain/organisation.js'
import { updateWithOptimisticLock } from '../repositories/index.js'
import { apiKeyAuthStrategy } from '../plugins/auth.js'
import { addVersionField, swaggerResponse } from './swagger-common.js'
import { createGovPayPayment } from '../services/govPay/index.js'
import boom from '@hapi/boom'
import { randomUUID } from 'node:crypto'
// swagger import { getPaymentsResponseSchema, putPaymentResponseSchema } from './schemas/payment.js'
// DONE authentication - pre-shared key?

const createPaymentReference = () => `WASTE-${randomUUID().replaceAll('-', '').toUpperCase()}`
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
      const paymentId = request.params.paymentId
      const organisationId = request.params.organisationId
      let shouldUpdateOrg = false
      const payment = await updateWithOptimisticLock(request.db.collection(paymentCollection), { paymentId, organisationId }, (dbPayment) => {
        if (dbPayment.status) {
          const p = updateFromGovPayEvent(dbPayment, request.payload.payment)
          shouldUpdateOrg = hasStatusChanged(dbPayment, p)
          return p
        } else {
          throw boom.notFound()
        }
      })
      if (shouldUpdateOrg) {
        const f = isPaid(payment) ? enableOrg : (o) => disableOrg(o, 'TODO Payment failed')
        const y = await updateWithOptimisticLock(request.db.collection(orgCollection), { organisationId }, (org) => {
          const x = f(org)
          return x
        })
      }
      return h.response({ message: 'success', payment })
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

      const reference = createPaymentReference()
      const { payload, status, statusCode } = await createGovPayPayment({ reference, amount, description, returnUrl, metadata }, request.logger)
      if (status === 'success') {
        const payment = await updateWithOptimisticLock(
          request.db.collection(paymentCollection),
          { paymentId: payload.payment_id, organisationId: request.params.organisationId },
          (_dbPayment) => {
            return initiatePayment(organisationId, payload.payment_id, amount, description, returnUrl, metadata, payload._links)
          }
        )
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

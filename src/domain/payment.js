import joi from 'joi'
import { randomUUID } from 'node:crypto'
// import * as common from './index.js'

export const paymentSchema = joi.object({
  organisationId: joi.string().required(),
  paymentId: joi.string().required(),
  status: joi.string(),
  reference: joi.string(),
  returnUrl: joi.string(),
  metadata: joi.object({ organisationId: joi.string().required(), organisationName: joi.string() }),
  amount: joi.number().integer()
})

const createPaymentReference = () => `WASTE-${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`

export const initiatePayment = (organisationId, paymentId, amount, description, returnUrl, metadata) => {
  metadata.organisationId = organisationId
  return { organisationId, paymentId, amount, description, returnUrl, metadata, reference: createPaymentReference(), status: 'payment_in_progress' }
}

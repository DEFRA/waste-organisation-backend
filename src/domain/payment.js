import joi from 'joi'
import { randomUUID } from 'node:crypto'
// import * as common from './index.js'

const linkData = joi.object({
  href: joi.string(),
  method: joi.string(),
  type: joi.string(),
  params: joi.object().pattern(joi.string(), joi.string())
})

export const paymentSchema = joi.object({
  organisationId: joi.string().required(),
  paymentId: joi.string().required(),
  status: joi.string(),
  reference: joi.string(),
  returnUrl: joi.string(),
  metadata: joi.object({ organisationId: joi.string().required(), organisationName: joi.string() }),
  amount: joi.number().integer(),
  govPayLinks: joi.object({
    self: linkData,
    next_url: linkData,
    next_url_post: linkData,
    events: linkData,
    refunds: linkData,
    cancel: linkData
  }),
  servicePeriodStart: joi.date(),
  servicePeriodEnd: joi.date(),
  createdDate: joi.date()
})

const createPaymentReference = () => `WASTE-${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`

export const initiatePayment = (organisationId, paymentId, amount, description, returnUrl, metadata) => {
  metadata.organisationId = organisationId
  return { organisationId, paymentId, amount, description, returnUrl, metadata, reference: createPaymentReference(), status: 'payment_in_progress' }
}

// TODO think about mapping statuses
const govPayStatusToStatus = (() => {
  const paymentMapping = {
    created: 'payment_in_progress',
    started: 'payment_in_progress',
    submitted: 'payment_in_progress',
    captureable: 'payment_in_progress',
    success: 'payment_succeeded',
    failed: 'payment_failed',
    cancelled: 'payment_failed',
    error: 'payment_failed'
  }
  const refundMapping = {
    // TODO if a refund fails, it it still paid for?
    pending: 'refund_in_progress',
    submitted: 'refund_in_progress',
    success: 'refund_succeeded',
    failed: 'refund_failed'
  }
  return (payload) => {
    const ps = payload?.state?.status
    const rs = payload?.refund_summary?.status
    if (rs) {
      return refundMapping[rs]
    } else {
      return paymentMapping[ps]
    }
  }
})()

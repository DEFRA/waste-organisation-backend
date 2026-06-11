import joi from 'joi'
import * as common from './index.js'

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
  metadata: joi.object({
    organisationId: joi.string().required(),
    organisationName: joi.string(),
    servicePeriodStart: joi.string(),
    servicePeriodEnd: joi.string()
  }),
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

export const initiatePayment = ({ organisationId, paymentId, amount, description, returnUrl, metadata, reference, govPayLinks }) => {
  metadata.organisationId = organisationId
  const payment = {
    organisationId,
    paymentId,
    amount,
    description,
    returnUrl,
    metadata,
    reference,
    status: 'payment_in_progress',
    servicePeriodStart: new Date(metadata.servicePeriodStart),
    servicePeriodEnd: new Date(metadata.servicePeriodEnd),
    govPayLinks
  }
  return common.validate(payment, paymentSchema)
}

export const govPayStatusToStatus = (() => {
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
    pending: 'refund_in_progress',
    submitted: 'refund_in_progress',
    success: 'refund_succeeded',
    failed: 'payment_succeeded',
    full: 'refund_succeeded'
    // available: 'refund_succeeded' // partial??
    // unavailable: '' // payment failed or can't be refunded again?
  }
  return (govPay) => {
    const ps = govPay?.state?.status
    const rs = govPay?.refund_summary?.status
    if (rs === 'available' && govPay?.amount !== govPay?.refund_summary?.amount_available) {
      return 'refund_succeeded'
    } else {
      return refundMapping[rs] || paymentMapping[ps]
    }
  }
})()

export const updateFromGovPayEvent = (payment, govPay) => {
  const status = govPayStatusToStatus(govPay)
  return common.validate({ ...payment, ...(status ? { status } : {}) }, paymentSchema)
}

export const isPaid = (payment) => payment.status === 'payment_succeeded'

export const isRefunded = (payment) => payment.status === 'refund_succeeded'

export const isFailed = (payment) => payment.status === 'payment_failed'

export const isPending = (payment) => payment.status === 'payment_in_progress'

export const hasStatusChanged = (oldPayment, newPayment) => oldPayment.status !== newPayment.status

import joi from 'joi'
import * as common from './index.js'
import { v4 as uuidv4 } from 'uuid'
import Boom from '@hapi/boom'
import { config } from '../config.js'

const freePeriodEnd = () => config.get('govPay.serviceChargeFreePeriodEnd')

const defaultOrgValues = (org) => {
  // TODO maybe not store this in the db??
  const disableAfter = org.disableAfter ?? freePeriodEnd()
  return {
    ...org,
    disableAfter
  }
}

export const apiCodeSchema = joi.object({
  name: joi.string().required(),
  code: joi.string().required(),
  isDisabled: joi.boolean()
})

export const orgSchemaWithoutApiCodes = joi.object({
  organisationId: joi.string().required(),
  users: joi.array().items(joi.string()), // NOTE removed this: .required()
  name: joi.string(),
  isWasteReceiver: joi.boolean(),
  isDisabled: joi.boolean(),
  disabledReason: joi.string().optional().allow(null),
  disableAfter: joi.date()
})

export const orgSchema = orgSchemaWithoutApiCodes.append({
  apiCodes: joi.array().items(apiCodeSchema)
})

export const ensureUserInOrg = (org, organisationId, userId) => {
  let users
  if (org && Array.isArray(org.users)) {
    if (org.users.includes(userId)) {
      users = org.users
    } else {
      users = [...org.users, userId]
    }
  } else {
    users = [userId]
  }
  return { ...org, organisationId, users }
}

export const mergeAndValidate = (dbOrg, requestOrg, organisationId, userId) => {
  delete requestOrg.users
  delete requestOrg.organisationId
  const org = userId ? ensureUserInOrg(dbOrg, organisationId, userId) : dbOrg
  return common.mergeAndValidate(defaultOrgValues(org), requestOrg, orgSchema)
}

export const createApiCode = (org, name) => {
  const apiCodes = org.apiCodes || []
  apiCodes.push({
    code: uuidv4().toString(),
    name: name || `API Code ${apiCodes.length + 1}`,
    isDisabled: false
  })
  return joi.attempt({ ...org, apiCodes }, orgSchema, 'Validation Error', {
    abortEarly: false,
    stripUnknown: true
  })
}

export const updateApiCode = (org, apiCode, name, isDisabled) => {
  const apiCodes = org.apiCodes || []
  const a = apiCodes.find(({ code }) => code === apiCode)
  if (a) {
    if (name != null) {
      a.name = name
    }
    if (isDisabled != null) {
      a.isDisabled = isDisabled
    }
  } else {
    throw Boom.notFound('not found')
  }
  return joi.attempt(org, orgSchema, 'Validation Error', {
    abortEarly: false,
    stripUnknown: true
  })
}

export const createOrg = (organisationId) => ({
  organisationId
})

export const disableOrg = (org, reason) => {
  return common.validate({ ...org, disabledReason: reason, isDisabled: true }, orgSchema)
}

export const enableOrg = (org) => {
  return common.validate({ ...org, isDisabled: false, disabledReason: null }, orgSchema)
}

export const isEnabled = (org, at) => org == null || (!org.isDisabled && (!org.disableAfter || (at || new Date()) < org.disableAfter))

export const updateOrganisationPaymentStatus = (org, payment) => {
  if (payment.status === 'payment_in_progress') {
    return common.validate(org, orgSchema)
  }

  if (payment.status === 'payment_succeeded') {
    return common.validate(updateDisableAfter({ ...org, disabledReason: null }, payment.servicePeriodEnd), orgSchema)
  }

  return common.validate({ ...org, disabledReason: 'Payment failed' }, orgSchema)
}

export const updateDisableAfter = (org, servicePeriodEnd) => {
  const disableAfter = org.disableAfter == null || org.disableAfter < servicePeriodEnd ? servicePeriodEnd : org.disableAfter
  return common.validate({ ...org, disableAfter }, orgSchema)
}

export const calculateNextPaymentPeriod = (() => {
  const getStartDate = (at) => {
    const s = freePeriodEnd()
    s.setFullYear(at.getFullYear() - 1)
    return s
  }

  const getPaymentWindowStart = (at, paymentPeriodStart) => {
    const [_, day, month] = config.get('govPay.serviceChargePaymentWindowStart').match(/([0-9]+)-([0-9]+)/) // nosonar
    const p = new Date(paymentPeriodStart)
    p.setFullYear(at.getFullYear())
    p.setDate(day)
    p.setMonth(month - 1)
    return p
  }

  return (org, at) => {
    const startDate = getStartDate(at)
    const paymentWindowStart = getPaymentWindowStart(at, startDate)
    const endOfFreePeriod = freePeriodEnd()
    const paymentPeriods = [null, null, null, null, null]
      .map((_) => {
        const p = new Date(startDate)
        startDate.setFullYear(p.getFullYear() + 1)
        return { from: p, to: new Date(startDate), priceInPence: config.get('govPay.serviceChargeAmountPence') }
      })
      .filter(({ to }) => to > endOfFreePeriod)
      .filter(({ from, to }) => {
        const noInitialData = org.disableAfter == null
        const periodPaidFor = from >= org.disableAfter
        const inRange = at > paymentWindowStart && at < to
        return inRange && (noInitialData || periodPaidFor)
      })
      .slice(0, 1)
    return { ...org, paymentPeriods }
  }
})()

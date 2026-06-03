import joi from 'joi'
import * as common from './index.js'
import crypto from 'node:crypto'
import Boom from '@hapi/boom'
import { config } from '../config.js'
import { isPaid, isFailed, isRefunded } from './payment.js'

const validate = (org) => {
  return common.validate({ ...org }, orgSchema)
}

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
    code: crypto.randomUUID(),
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
  return validate({ ...org, disabledReason: reason, isDisabled: true })
}

export const enableOrg = (org) => {
  return validate({ ...org, isDisabled: false, disabledReason: null })
}

export const isEnabled = (org, at) => org == null || (!org.isDisabled && (at || new Date()) < (org.disableAfter || freePeriodEnd()))

export const updateOrganisationPaymentStatus = (org, payment) => {
  if (isPaid(payment)) {
    return validate(updateDisableAfter({ ...org, disabledReason: null }, payment.servicePeriodEnd))
  }
  if (isRefunded(payment)) {
    // Note: only allow refunding the current year - refunds of previous years shouldn't disable the org
    if (org.disableAfter <= payment.servicePeriodEnd) {
      return validate(moveDisableAfterBackwards({ ...org, disabledReason: null }, payment.servicePeriodStart))
    } else {
      return validate(org)
    }
  }
  if (isFailed(payment)) {
    return validate({ ...org, disabledReason: 'Payment failed' })
  }
  return validate(org)
}

export const updateDisableAfter = (org, servicePeriodEnd) => {
  const disableAfter = org.disableAfter == null || org.disableAfter < servicePeriodEnd ? servicePeriodEnd : org.disableAfter
  return validate({ ...org, disableAfter })
}

export const moveDisableAfterBackwards = (org, servicePeriodEnd) => {
  const disableAfter = org.disableAfter == null || org.disableAfter > servicePeriodEnd ? servicePeriodEnd : org.disableAfter
  return validate({ ...org, disableAfter })
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

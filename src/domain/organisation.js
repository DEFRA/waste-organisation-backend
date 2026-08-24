import joi from 'joi'
import * as common from './index.js'
import crypto from 'node:crypto'
import Boom from '@hapi/boom'
import { config } from '../config.js'
import { isPaid, isFailed, isRefunded } from './payment.js'

const validate = (org) => {
  return common.validate({ ...org }, orgSchema)
}

const freePeriodEnd = () => new Date(config.get('govPay.serviceChargeFreePeriodEnd'))

const defaultOrgValues = (org) => {
  const disableAfter = org.disableAfter ?? null
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
  disableAfter: joi.date().allow(null),
  isLocalAuthority: joi.boolean().optional()
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

export const ensureAtLeastOneApiCodeExists = (org) => {
  if (org.apiCodes == null) {
    return createApiCode(org)
  } else {
    return org
  }
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

export const isEnabled = (org, at) => org == null || (!org.isDisabled && hasPaid(org, at))

export const hasPaid = (org, at) => org == null || (at || new Date()) < (org.disableAfter || freePeriodEnd())

export const updateOrganisationPaymentStatus = (org, payment) => {
  if (isPaid(payment)) {
    return validate(updateDisableAfter({ ...org, disabledReason: null }, payment.servicePeriodEnd))
  }
  if (isRefunded(payment)) {
    // Note: only allow refunding the current year - refunds of previous years shouldn't disable the org
    if (org.disableAfter != null && org.disableAfter <= payment.servicePeriodEnd) {
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
  return validate(ensureAtLeastOneApiCodeExists({ ...org, disableAfter }))
}

export const moveDisableAfterBackwards = (org, servicePeriodEnd) => {
  const disableAfter = org.disableAfter == null || org.disableAfter > servicePeriodEnd ? servicePeriodEnd : org.disableAfter
  return validate(ensureAtLeastOneApiCodeExists({ ...org, disableAfter }))
}

export const calculateNextPaymentPeriod = (() => {
  const getStartDate = (at, org) => {
    const s = org.disableAfter == null ? freePeriodEnd() : new Date(org.disableAfter)
    s.setFullYear(at.getFullYear() - 1)
    return s
  }

  const getPaymentWindowStart = (at, paymentPeriodStart, org) => {
    const [_, day, month] = config.get('govPay.serviceChargePaymentWindowStart').match(/([0-9]+)-([0-9]+)/) // nosonar
    const p = new Date(paymentPeriodStart)
    p.setFullYear(at.getFullYear())
    p.setDate(day)
    p.setMonth(month - 1)
    const sevenDaysBefore = 604800000
    if (org?.disableAfter != null && org.disableAfter.getTime() < p.getTime() - sevenDaysBefore) {
      return new Date(org.disableAfter.getTime() - sevenDaysBefore)
    }
    return p
  }

  const getNextYear = (at) => {
    const d = new Date(at)
    d.setFullYear(at.getFullYear() + 1)
    return d
  }

  return (org, at) => {
    const noInitialData = org.disableAfter == null
    const startDate = getStartDate(at, org)
    const paymentWindowStart = getPaymentWindowStart(at, startDate, org)
    const endOfFreePeriod = freePeriodEnd()
    const nextYear = getNextYear(at)
    const paymentPeriods = [null, null, null, null, null]
      .map((_) => {
        const p = new Date(startDate)
        startDate.setFullYear(p.getFullYear() + 1)
        return { from: p, to: new Date(startDate), priceInPence: config.get('govPay.serviceChargeAmountPence') }
      })
      .filter(({ to }) => to > endOfFreePeriod && at <= to)
      .filter(({ from }) => {
        const periodNotPaidFor = from >= org.disableAfter
        const paymentWindowOpen = at > paymentWindowStart && from <= nextYear
        return noInitialData || (paymentWindowOpen && periodNotPaidFor)
      })
      .slice(0, 1)
    return { ...org, paymentPeriods }
  }
})()

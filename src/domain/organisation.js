import joi from 'joi'
import * as common from './index.js'
import { v4 as uuidv4 } from 'uuid'
import Boom from '@hapi/boom'
import { config } from '../config.js'

const defaultOrgValues = (org) => {
  // TODO maybe not store this in the db??
  const disableAfter = org.disableAfter ?? config.get('govPay.serviceChargeFreePeriodEnd')
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
  disabledReason: joi.string(),
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
  return { ...org, isDisabled: true, disabledReason: reason }
}

export const enableOrg = (org) => {
  return { ...org, isDisabled: false, disabledReason: null }
}

export const isEnabled = (org, at) => org == null || (!org.isDisabled && (!org.disableAfter || (at || new Date()) < org.disableAfter))

export const updateDisableAfter = (org, servicePeriodEnd) => {
  const disableAfter = org.disableAfter == null || org.disableAfter < servicePeriodEnd ? servicePeriodEnd : org.disableAfter
  return { ...org, disableAfter }
}

export const calculateNextPaymentPeriod = (org, at) => {
  const startDate = config.get('govPay.serviceChargeFreePeriodEnd')
  startDate.setFullYear(at.getFullYear() - 1)
  const maxPayentYear = config.get('govPay.serviceChargeFreePeriodEnd')
  maxPayentYear.setFullYear(at.getFullYear())
  const endOfFreePeriod = config.get('govPay.serviceChargeFreePeriodEnd')
  const paymentPeriods = [null, null, null, null]
    .map((_) => {
      const p = new Date(startDate)
      startDate.setFullYear(p.getFullYear() + 1)
      return { from: p, to: new Date(startDate) }
    })
    .filter(({ to, from }) => to > at && from <= maxPayentYear && to > endOfFreePeriod && (org.disableAfter == null || from <= org.disableAfter))
  return { ...org, paymentPeriods }
}

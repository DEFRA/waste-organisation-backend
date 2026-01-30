import joi from 'joi'
import * as common from './index.js'
import { v4 as uuidv4 } from 'uuid'
import Boom from '@hapi/boom'

export const apiCodeSchema = joi.object({
  name: joi.string().required(),
  code: joi.string().required(),
  isDisabled: joi.boolean()
})

export const orgSchema = joi.object({
  organisationId: joi.string().required(),
  users: joi.array().items(joi.string()), // NOTE removed this: .required()
  name: joi.string(),
  apiCodes: joi.array().items(apiCodeSchema),
  isWasteReceiver: joi.boolean()
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
  return common.mergeAndValidate(org, requestOrg, orgSchema)
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

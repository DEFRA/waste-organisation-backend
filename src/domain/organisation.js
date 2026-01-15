import joi from 'joi'
import * as common from './index.js'

export const orgSchema = joi.object({
  organisationId: joi.string().required(),
  users: joi.array().items(joi.string()).required(),
  name: joi.string(),
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
  const org = ensureUserInOrg(dbOrg, organisationId, userId)
  return common.mergeAndValidate(org, requestOrg, orgSchema)
}

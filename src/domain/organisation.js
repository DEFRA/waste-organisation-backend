import joi from 'joi'

export const orgSchema = joi.object({
  organisationId: joi.string().required(),
  users: joi.array().items(joi.string()).required(),
  name: joi.string(),
  isWasteReceiver: joi.boolean()
})

const ensureUserInOrg = (org, organisationId, userId) => {
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

export const mergeParams = (dbOrg, requestOrg, organisationId, userId) => {
  let org = dbOrg
  if (org) {
    org = {
      ...org,
      ...requestOrg
    }
  } else {
    org = requestOrg
  }
  return ensureUserInOrg(org, organisationId, userId)
}

export const mergeAndValidate = (dbOrg, requestOrg, organisationId, userId) => {
  const org = mergeParams(dbOrg, requestOrg, organisationId, userId)
  const { error, value } = orgSchema.validate(org)
  return { error, organisation: value }
}

import joi from 'joi'

export const orgSchema = joi.object({
  organisationId: joi.string().required(),
  users: joi.array().items(joi.string()).required(),
  name: joi.string(),
  isWasteReceiver: joi.boolean(),
  connections: joi.object().pattern(joi.string(), joi.string())
})

export const ensureUserInOrg = (org, userId) => {
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
  return { ...org, users }
}

const ensureOrganisationId = (org, organisationId) => {
  return { ...org, organisationId }
}

const mergeParams = (dbOrg, requestOrg, organisationId, userId) => {
  return ensureOrganisationId(
    ensureUserInOrg({ ...dbOrg, ...requestOrg }, userId),
    organisationId
  )
}

export const mergeAndValidate = (dbOrg, requestOrg, organisationId, userId) => {
  const org = mergeParams(dbOrg, requestOrg, organisationId, userId)
  const { error, value } = orgSchema.validate(org)
  return { error, organisation: value }
}

export const removeUserConnection = (org, connectionId) => {
  if (org?.connections) {
    const uid = org.connections[connectionId]
    const connections = { ...org.connections }
    delete connections[connectionId]
    return { ...org, connections, users: org.users.filter((u) => u !== uid) }
  } else {
    return org
  }
}

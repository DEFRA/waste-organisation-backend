import joi from 'joi'

export const orgSchema = joi.object({
  organisationId: joi.string().required(),
  users: joi.array().items(joi.string()).required(),
  name: joi.string(),
  isWasteReceiver: joi.boolean(),
  connections: joi
    .array()
    .items(joi.object({ id: joi.string(), userId: joi.string() }))
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
    return org.connections.reduce(
      (org, c) => {
        if (c.id === connectionId) {
          org.users = org.users.filter((u) => u !== c.userId)
        } else {
          org.connections.push(c)
        }
        return org
      },
      { ...org, connections: [] }
    )
  } else {
    return org
  }
}

export const addUserConnection = (org, connection) => {
  const cs = (org?.connections || []).filter(({ id }) => id !== connection.id)
  cs.push(connection)
  return { ...ensureUserInOrg(org, connection.userId), connections: cs }
}

export const updateUserConnection = (org, connection) =>
  connection.userId
    ? addUserConnection(org, connection)
    : removeUserConnection(org, connection.id)

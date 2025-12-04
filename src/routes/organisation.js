// import Boom from '@hapi/boom'
import { paths } from '../config/paths.js'
import joi from 'joi'

export const orgCollection = 'organisations'

const findAllOrganisationsForUser = (db, userId) => {
  const cursor = db
    .collection(orgCollection)
    .find(
      { users: { $elemMatch: { $eq: userId } } },
      { projection: { _id: 0 } }
    )
  return cursor.toArray()
}

const findOrganisationById = (db, orgId) => {
  return db
    .collection(orgCollection)
    .findOne({ organisationId: { $eq: orgId } }, { projection: { _id: 0 } })
}

export const orgSchema = joi.object({
  organisationId: joi.string().required(),
  users: joi.array().items(joi.string()).required(),
  name: joi.string(),
  isWasteReceiver: joi.boolean()
})

const saveOrganisation = (db, orgId, org) => {
  return db.collection(orgCollection).updateOne(
    { organisationId: orgId },
    {
      $set: org
    },
    {
      upsert: true
    }
  )
}

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

export const organisations = [
  {
    method: 'GET',
    path: paths.getOrganisations,
    handler: async (request, h) => {
      const orgs = await findAllOrganisationsForUser(
        request.db,
        request.params.userId
      )
      return h.response({ message: 'success', orgs })
    }
  },
  {
    method: 'PUT',
    path: paths.putOrganisation,
    handler: async (request, h) => {
      let org = await findOrganisationById(
        request.db,
        request.params.organisationId
      )
      org = mergeParams(
        org,
        request?.payload?.organisation,
        request.params.organisationId,
        request.params.userId
      )
      const { error, value } = orgSchema.validate(org)
      if (error) {
        return h.response({
          message: 'error',
          organisation: org,
          errors: error
        })
      } else {
        await saveOrganisation(request.db, org.organisationId, value)
        return h.response({ message: 'success', organisation: org })
      }
    }
  }
]

// import Boom from '@hapi/boom'
import { paths } from '../config/paths.js'

const orgCollection = 'organisations'

function findAllOrganisationsForUser(db, userId) {
  // TODO model relationship between users and orgs
  const cursor = db
    .collection(orgCollection)
    .find({ userId }, { projection: { _id: 0 } })

  return cursor.toArray()
}

function findOrganisationForUserById(db, orgId, uId) {
  return db
    .collection(orgCollection)
    .findOne({ organisationId: orgId, userId: uId }, { projection: { _id: 0 } })
}

function saveOrganisation(db, orgId, org) {
  // TODO validate org
  console.log(orgId, org)
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
      const org = await findOrganisationForUserById(
        request.db,
        request.params.organisationId,
        request.params.userId
      )
      console.log(request.payload)
      if (org) {
        await saveOrganisation(request.db, request.params.organisationId, {
          ...org,
          ...request.payload
        })
      } else {
        await saveOrganisation(
          request.db,
          request.params.organisationId,
          request.payload
        )
      }
      return h.response({ message: 'success', org })
    }
  }
]

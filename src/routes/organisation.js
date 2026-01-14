// import Boom from '@hapi/boom'
import { paths } from '../config/paths.js'
import { mergeAndValidate } from '../domain/organisation.js'
import {
  findAllOrganisationsForUser,
  orgCollection
} from '../repositories/organisation.js'
import { updateWithOptimisticLock } from '../repositories/index.js'
// DONE authentication - pre-shared key?

export const organisations = [
  {
    method: 'GET',
    path: paths.getOrganisations,
    options: { auth: 'api-key-auth' },
    handler: async (request, h) => {
      const orgs = await findAllOrganisationsForUser(
        request.db,
        request.params.userId
      )
      return h.response({ message: 'success', organisations: orgs })
    }
  },
  {
    method: 'PUT',
    path: paths.putOrganisation,
    options: { auth: 'api-key-auth' },
    handler: async (request, h) => {
      try {
        const organisation = await updateWithOptimisticLock(
          request.db.collection(orgCollection),
          { organisationId: request.params.organisationId },
          (dbOrg) => {
            const organisationId = request.params.organisationId
            const userId = request.params.userId
            return mergeAndValidate(
              dbOrg,
              {
                organisationId,
                userId,
                ...request?.payload?.organisation
              },
              organisationId,
              userId
            )
          }
        )
        return h.response({ message: 'success', organisation })
      } catch (e) {
        return h.response({
          message: 'error',
          errors: e.isJoi ? e.details : [`${e}`]
        })
      }
    }
  }
]

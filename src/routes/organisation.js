// import Boom from '@hapi/boom'
import { paths } from '../config/paths.js'
import { mergeAndValidate } from '../domain/organisation.js'
import {
  findAllOrganisationsForUser,
  findOrganisationById,
  saveOrganisation
} from '../repositories/organisation.js'

// DONE authentication - pre-shared key?
// TODO add db locks to PUT

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
      const org = await findOrganisationById(
        request.db,
        request.params.organisationId
      )
      const { error, organisation } = mergeAndValidate(
        org,
        request?.payload?.organisation,
        request.params.organisationId,
        request.params.userId
      )
      if (error) {
        return h.response({
          message: 'error',
          organisation: org,
          errors: error
        })
      } else {
        await saveOrganisation(
          request.db,
          organisation.organisationId,
          organisation
        )
        return h.response({ message: 'success', organisation })
      }
    }
  }
]

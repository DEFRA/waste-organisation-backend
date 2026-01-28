// import Boom from '@hapi/boom'
import { paths } from '../config/paths.js'
import { mergeAndValidate } from '../domain/organisation.js'
import {
  findOrganisationById,
  orgCollection
} from '../repositories/organisation.js'
import { updateWithOptimisticLock } from '../repositories/index.js'

export const apiCodeRoutes = [
  {
    method: 'GET',
    path: paths.listApiCodes,
    options: { auth: 'api-key-auth' },
    handler: async (request, h) => {
      const { apiCodes } = await findOrganisationById(
        request.db,
        request.params.organisationId
      )
      return h.response({ message: 'success', apiCodes })
    }
  },
  {
    method: 'PUT',
    path: paths.saveApiCode,
    options: { auth: 'api-key-auth' },
    handler: async (request, h) => {
      try {
        const organisation = await updateWithOptimisticLock(
          request.db.collection(orgCollection),
          { organisationId: request.params.organisationId },
          (dbOrg) => {
            const organisationId = request.params.organisationId
            const apiCodes = { ...dbOrg.apiCodes }
            apiCodes[request.params.apiCode] = {
              name: request.payload?.apiCode?.name,
              apiCode: request.params.apiCode
            }
            if (request.payload?.apiCode?.disabled) {
              apiCodes[request.params.apiCode].disabled = true
            }
            return mergeAndValidate(
              dbOrg,
              { organisationId, apiCodes },
              organisationId,
              null
            )
          }
        )
        return h.response({
          message: 'success',
          apiCode: organisation.apiCodes[request.params.apiCode]
        })
      } catch (e) {
        return h.response({
          message: 'error',
          errors: e.isJoi ? e.details : [`${e}`]
        })
      }
    }
  }
]

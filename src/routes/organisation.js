import { paths } from '../config/paths.js'
import { mergeAndValidate, createApiCode, orgSchemaWithoutApiCodes } from '../domain/organisation.js'
import { orgCollection } from '../repositories/organisation.js'
import { updateWithOptimisticLock } from '../repositories/index.js'
import { apiKeyAuthStrategy } from '../plugins/auth.js'
import { addVersionField, swaggerResponse } from './swagger-common.js'

export const organisations = [
  {
    method: 'PUT',
    path: paths.putOrganisation,
    options: {
      auth: apiKeyAuthStrategy,
      tags: ['api'],
      response: { schema: swaggerResponse({ organisation: addVersionField(orgSchemaWithoutApiCodes) }), sample: 0 }
    },
    handler: async (request, h) => {
      try {
        const organisation = await updateWithOptimisticLock(
          request.db.collection(orgCollection),
          { organisationId: request.params.organisationId },
          (dbOrg) => {
            const organisationId = request.params.organisationId
            const userId = request.params.userId
            const org = mergeAndValidate(
              dbOrg,
              {
                organisationId,
                userId,
                ...request?.payload?.organisation
              },
              organisationId,
              userId
            )
            if (org.apiCodes == null) {
              return createApiCode(org)
            } else {
              return org
            }
          }
        )
        console.log('organisation: ', JSON.stringify(organisation, null, 4))
        delete organisation.apiCodes
        return h.response({ message: 'success', organisation })
      } catch (e) {
        console.log('organisation error: ', JSON.stringify(e, null, 4))
        return h.response({
          message: 'error',
          errors: e.isJoi ? e.details : [`${e}`]
        })
      }
    }
  }
]

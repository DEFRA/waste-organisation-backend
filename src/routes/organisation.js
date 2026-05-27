import { paths } from '../config/paths.js'
import { mergeAndValidate, createApiCode, orgSchemaWithoutApiCodes, calculateNextPaymentPeriod } from '../domain/organisation.js'
import { orgCollection, findOrganisationById } from '../repositories/organisation.js'
import { updateWithOptimisticLock } from '../repositories/index.js'
import { apiKeyAuthStrategy } from '../plugins/auth.js'
import { addVersionField, swaggerResponse } from './swagger-common.js'
import boom from '@hapi/boom'

export const organisations = [
  {
    method: 'GET',
    path: paths.getOrganisation,
    options: {
      auth: apiKeyAuthStrategy,
      tags: ['api'],
      response: { schema: swaggerResponse({ organisation: addVersionField(orgSchemaWithoutApiCodes) }), sample: 0 }
    },
    handler: async (request, h) => {
      const organisation = await findOrganisationById(request.db, request.params.organisationId)
      if (organisation) {
        if (organisation.users.includes(request.params.userId)) {
          return h.response({
            message: 'success',
            organisation: calculateNextPaymentPeriod(organisation, request?.info?.received ? new Date(request?.info?.received) : new Date())
          })
        } else {
          throw boom.forbidden()
        }
      } else {
        throw boom.notFound()
      }
    }
  },
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
        delete organisation.apiCodes
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

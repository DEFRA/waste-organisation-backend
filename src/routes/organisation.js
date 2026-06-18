import { paths } from '../config/paths.js'
import { mergeAndValidate, createApiCode, orgSchemaWithouApiCodes } from '../domain/organisation.js'
import { orgCollection } from '../repositories/organisation.js'
import { updateWithOptimisticLock } from '../repositories/index.js'
import { apiKeyAuthStrategy } from '../plugins/auth.js'
import { addVersionField, swaggerResponse } from './swagger-common.js'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

export const organisations = [
  {
    method: 'PUT',
    path: paths.putOrganisation,
    options: {
      auth: apiKeyAuthStrategy,
      tags: ['api'],
      response: { schema: swaggerResponse({ organisation: addVersionField(orgSchemaWithouApiCodes) }), sample: 0 }
    },
    handler: async (request, h) => {
      try {
        let transactionType = 'updated'
        const organisation = await updateWithOptimisticLock(
          request.db.collection(orgCollection),
          { organisationId: request.params.organisationId },
          (dbOrg) => {
            if (!dbOrg._id) {
              transactionType = 'created'
            }

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

        logger.info(
          `Organisation ${transactionType}: ${JSON.stringify({
            organisationId: organisation.organisationId,
            createdAt: organisation.createdAt
          })}`
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

import joi from 'joi'
import { paths } from '../config/paths.js'
import { config } from '../config.js'
import { mergeAndValidate, ensureAtLeastOneApiCodeExists, orgSchemaWithoutApiCodes, calculateNextPaymentPeriod } from '../domain/organisation.js'
import { orgCollection, findOrganisationById, findOrganisationsByDateRange } from '../repositories/organisation.js'
import { updateWithOptimisticLock } from '../repositories/index.js'
import { apiKeyAuthStrategy } from '../plugins/auth.js'
import { addVersionField, swaggerResponse } from './swagger-common.js'
import boom from '@hapi/boom'

export const organisations = [
  {
    method: 'GET',
    path: paths.getOrganisationsByDateRange,
    options: {
      auth: apiKeyAuthStrategy,
      tags: ['api'],
      description: 'List organisations registered within a date range',
      validate: {
        query: joi.object({
          startDate: joi.date().iso().required().description('Start of the registration date range (inclusive)'),
          endDate: joi.date().iso().min(joi.ref('startDate')).required().description('End of the registration date range (inclusive; may equal startDate)')
        })
      },
      response: {
        schema: joi.array().items(
          joi.object({
            organisationId: joi.string().required(),
            dateRegistered: joi.date().required(),
            activeApiCodeCount: joi.number().integer().required().strict()
          })
        ),
        sample: 0
      }
    },
    handler: async (request, h) => {
      const { startDate, endDate } = request.query
      return h.response(await findOrganisationsByDateRange(request.db, startDate, endDate))
    }
  },
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
          const organisationWithEffectiveDisableAfter = {
            ...organisation,
            disableAfter: organisation.disableAfter ?? config.get('govPay.serviceChargeFreePeriodEnd')
          }
          return h.response({
            message: 'success',
            organisation: calculateNextPaymentPeriod(
              organisationWithEffectiveDisableAfter,
              request?.info?.received ? new Date(request?.info?.received) : new Date()
            )
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
            return ensureAtLeastOneApiCodeExists(org)
          }
        )
        delete organisation.apiCodes

        request.logger.info(
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

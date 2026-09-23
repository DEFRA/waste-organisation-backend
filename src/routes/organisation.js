import joi from 'joi'
import { paths } from '../config/paths.js'
import { config } from '../config.js'
import { mergeAndValidate, ensureAtLeastOneApiCodeExists, orgSchemaWithoutApiCodes, calculateNextPaymentPeriod } from '../domain/organisation.js'
import { orgCollection, findOrganisationById, findOrganisationsByDateRange } from '../repositories/organisation.js'
import { updateWithOptimisticLock } from '../repositories/index.js'
import { apiKeyAuthStrategy } from '../plugins/auth.js'
import { addVersionField, swaggerResponse } from './swagger-common.js'
import boom from '@hapi/boom'

const getApiCodeEvent = (code, oldApiCodes) => {
  let apiCodeEvent = null
  if (oldApiCodes[code.code] == null) {
    apiCodeEvent = 'created'
  } else {
    if (code.isDisabled && !oldApiCodes[code.code].isDisabled) {
      apiCodeEvent = 'revoked'
    }
    if (!code.isDisabled && oldApiCodes[code.code].isDisabled) {
      apiCodeEvent = 're-enabled'
    }
    delete oldApiCodes[code.code]
  }
  return apiCodeEvent
}

const logPutMessages = (organisation, transactionType, oldApiCodes, logger) => {
  for (const code of organisation.apiCodes) {
    const apiCodeEvent = getApiCodeEvent(code, oldApiCodes)

    if (apiCodeEvent) {
      logger.info(`GRAFANA_REPORT >> api_code_lifecycle_changed >> ${apiCodeEvent}`, {
        organisationId: organisation.organisationId,
        apiCodeEvent
      })
    }
  }
  for (const _ in oldApiCodes) {
    logger.info(`GRAFANA_REPORT >> api_code_lifecycle_changed >> deleted`, {
      organisationId: organisation.organisationId,
      apiCodeEvent: 'deleted'
    })
  }

  logger.info(`GRAFANA_REPORT >> organisation >> organisation_${transactionType} >> Organisation ${transactionType}`, {
    organisationId: organisation.organisationId,
    isLocalAuthority: organisation.isLocalAuthority,
    createdAt: organisation.createdAt
  })
}

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
          return h.response({
            message: 'success',
            organisation: {
              ...calculateNextPaymentPeriod(organisation, request?.info?.received ? new Date(request?.info?.received) : new Date()),
              disableAfter: organisation.disableAfter ?? config.get('govPay.serviceChargeFreePeriodEnd')
            }
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
        let oldApiCodes = {}
        const organisation = await updateWithOptimisticLock(
          request.db.collection(orgCollection),
          { organisationId: request.params.organisationId },
          (dbOrg) => {
            let paramOrg = request?.payload?.organisation
            if (dbOrg?.apiCodes != null) {
              oldApiCodes = dbOrg.apiCodes.reduce((acc, c) => {
                acc[c.code] = { ...c }
                return acc
              }, {})
            }

            if (!dbOrg._id) {
              transactionType = 'created'
              paramOrg = { ...request?.payload?.initialValues, ...paramOrg }
            }

            const organisationId = request.params.organisationId
            const userId = request.params.userId
            const org = mergeAndValidate(
              dbOrg,
              {
                ...paramOrg,
                organisationId,
                userId
              },
              organisationId,
              userId
            )
            return ensureAtLeastOneApiCodeExists(org)
          }
        )
        logPutMessages(organisation, transactionType, oldApiCodes, request.logger)
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

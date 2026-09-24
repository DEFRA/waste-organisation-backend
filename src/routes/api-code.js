import Boom from '@hapi/boom'
import joi from 'joi'
import { paths } from '../config/paths.js'
import { createApiCode, updateApiCode, apiCodeSchema, isEnabled, hasPaid } from '../domain/organisation.js'
import { findOrganisationByApiCode, findOrganisationById, orgCollection } from '../repositories/organisation.js'
import { updateWithOptimisticLock } from '../repositories/index.js'
import { apiKeyAuthStrategy } from '../plugins/auth.js'
import { config } from '../config.js'

const freePeriodEnd = () => config.get('govPay.serviceChargeFreePeriodEnd')

const handleErr = (e, logger) => {
  logger.error(`Error with request: ${e}`)
  if (e.isBoom) {
    throw e
  }
  if (e.isJoi) {
    throw Boom.badRequest(e.details.map(({ message }) => message).join(', '))
  }
  throw Boom.badRequest(`${e}`)
}

export const apiCodeRoutes = [
  {
    method: 'GET',
    path: paths.lookupOrgFromApiCode,
    options: {
      auth: apiKeyAuthStrategy,
      tags: ['api'],
      response: {
        schema: joi.object({
          defraOrganisationId: joi.string().required()
        }),
        sample: 0
      }
    },
    handler: async (request, h) => {
      const apiCode = request.params.apiCode
      const org = await findOrganisationByApiCode(request.db, apiCode)

      if (!hasPaid(org)) {
        throw Boom.paymentRequired()
      }

      if (isEnabled(org) && org?.apiCodes.find(({ code }) => code === apiCode).isDisabled === false) {
        return h.response({ defraCustomerOrganisationId: org.organisationId, metaData: { disableAfter: org.disableAfter || freePeriodEnd() } })
      } else {
        throw Boom.notFound()
      }
    }
  },
  {
    method: 'GET',
    path: paths.listApiCodes,
    options: {
      auth: apiKeyAuthStrategy,
      tags: ['api'],
      response: { schema: joi.object({ apiCodes: joi.array().items(apiCodeSchema).required() }), sample: 0 }
    },
    handler: async (request, h) => {
      const r = await findOrganisationById(request.db, request.params.organisationId)
      if (r) {
        return h.response({ apiCodes: r.apiCodes })
      } else {
        throw Boom.notFound()
      }
    }
  },
  {
    method: 'POST',
    path: paths.createApiCode,
    options: { auth: apiKeyAuthStrategy, tags: ['api'], response: { schema: apiCodeSchema, sample: 0 } },
    handler: async (request, h) => {
      try {
        const organisation = await updateWithOptimisticLock(request.db.collection(orgCollection), { organisationId: request.params.organisationId }, (dbOrg) =>
          createApiCode(dbOrg, request.payload?.apiCode?.name)
        )
        const apiCode = organisation.apiCodes[organisation.apiCodes.length - 1]
        request.logger.info(`GRAFANA_REPORT >> api_code_lifecycle_changed >> created`, { organisationId: organisation.organisationId })
        return h.response(apiCode)
      } catch (e) {
        return handleErr(e, request.logger)
      }
    }
  },
  {
    method: 'PUT',
    path: paths.saveApiCode,
    options: { auth: apiKeyAuthStrategy, tags: ['api'], response: { schema: apiCodeSchema, sample: 0 } },
    handler: async (request, h) => {
      try {
        let oldApiCode = null
        const organisation = await updateWithOptimisticLock(
          request.db.collection(orgCollection),
          { organisationId: request.params.organisationId },
          (dbOrg) => {
            oldApiCode = { ...dbOrg.apiCodes.find(({ code }) => code === request.params.apiCode) }
            return updateApiCode(dbOrg, request.params.apiCode, request.payload?.apiCode?.name, request.payload?.apiCode?.isDisabled)
          }
        )
        const apiCode = organisation.apiCodes.find(({ code }) => code === request.params.apiCode)
        if (oldApiCode.isDisabled !== apiCode.isDisabled) {
          request.logger.info(`GRAFANA_REPORT >> api_code_lifecycle_changed >> ${apiCode.isDisabled ? 'revoked' : 're-enabled'}`, {
            organisationId: organisation.organisationId
          })
        }
        return h.response(apiCode)
      } catch (e) {
        return handleErr(e, request.logger)
      }
    }
  }
]

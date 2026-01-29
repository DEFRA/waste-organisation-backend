import Boom from '@hapi/boom'
import { paths } from '../config/paths.js'
import { createApiCode, updateApiCode } from '../domain/organisation.js'
import {
  findOrganisationById,
  orgCollection
} from '../repositories/organisation.js'
import { updateWithOptimisticLock } from '../repositories/index.js'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

const handleErr = (e) => {
  logger.error(`Error with request: ${e}`)
  if (e.isBoom) {
    throw e
  }
  // console.log('errors: ', e)
  if (e.isJoi) {
    throw Boom.badRequest(e.details.map(({ message }) => message).join(', '))
  }
  throw Boom.badRequest(`${e}`)
}

const options = { auth: 'api-key-auth' }

export const apiCodeRoutes = [
  {
    method: 'GET',
    path: paths.listApiCodes,
    options,
    handler: async (request, h) => {
      const r = await findOrganisationById(
        request.db,
        request.params.organisationId
      )
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
    options,
    handler: async (request, h) => {
      try {
        const organisation = await updateWithOptimisticLock(
          request.db.collection(orgCollection),
          { organisationId: request.params.organisationId },
          (dbOrg) => createApiCode(dbOrg, request.payload?.apiCode?.name)
        )
        const apiCode = organisation.apiCodes[organisation.apiCodes.length - 1]
        return h.response(apiCode)
      } catch (e) {
        return handleErr(e)
      }
    }
  },
  {
    method: 'PUT',
    path: paths.saveApiCode,
    options,
    handler: async (request, h) => {
      try {
        const organisation = await updateWithOptimisticLock(
          request.db.collection(orgCollection),
          { organisationId: request.params.organisationId },
          (dbOrg) =>
            updateApiCode(
              dbOrg,
              request.params.apiCode,
              request.payload?.apiCode?.name,
              request.payload?.apiCode?.isDisabled
            )
        )
        const apiCode = organisation.apiCodes.find(
          ({ code }) => code === request.params.apiCode
        )
        return h.response(apiCode)
      } catch (e) {
        return handleErr(e)
      }
    }
  }
]

import crypto from 'node:crypto'
import { paths } from '../config/paths.js'
import { bulkImport } from '../services/bulkImport.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { apiKeyAuthStrategy } from '../plugins/auth.js'

const logger = createLogger()

const postHandler = async (request, h) => {
  const organisationId = request.params.organisationId
  const movement = request.payload?.movement
  const bulkUploadId = crypto.randomUUID()
  const traceId = request.getTraceId?.()

  logger.info(`Manual entry movement for org ${organisationId}, bulkUploadId ${bulkUploadId}`)

  const result = await bulkImport(bulkUploadId, [movement], traceId)

  if (result?.failed) {
    logger.error(`Bulk API failed for manual entry ${bulkUploadId}`)
    return h.response({ message: 'error', errors: ['Bulk API submission failed'] }).code(502)
  }

  if (result?.errors) {
    logger.warn(`Bulk API validation errors for manual entry ${bulkUploadId}`)
    return h.response({ message: 'error', errors: result.errors }).code(400)
  }

  return h.response({ message: 'success', result })
}

export const movementRoutes = [
  {
    method: 'POST',
    path: paths.postMovement,
    options: { auth: apiKeyAuthStrategy, tags: ['api'] },
    handler: postHandler
  }
]

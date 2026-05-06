import wreck from '@hapi/wreck'
import { config } from '../config.js'
import { pathTo } from '../config/paths.js'
import { HTTP_BAD_REQUEST, TRANSIENT_STATUS_CODES } from './httpStatusCodes.js'

const formatErrorDetail = (e) => (e instanceof Error ? e.stack : JSON.stringify(e))

const extractValidationErrors = (e, uploadId, logger) => {
  logger.debug(`ReferenceNumber: ${uploadId} -- Validation errors processing spreadsheet ${e.data}`)
  if (Array.isArray(e.data?.payload)) {
    const validationPayload = e.data.payload
    const errors = validationPayload.flatMap((v) => v?.validation?.errors || [])
    if (errors.length > 0) {
      return { errors }
    }
  }
  if (typeof e.data?.payload === 'object') {
    const errors = e.data?.payload?.validation?.errors || []
    if (errors.length > 0) {
      return { errors }
    }
  }
  // Validation failed [{"key":"BulkUpdateMovementRequest","errorType":"OutOfRange","message":"\"BulkUpdateMovementRequest\" must contain at least 1 items"}]
  logger.warn(`ReferenceNumber: ${uploadId} -- Bulk API returned 400 with no extractable validation errors (payload: ${e.data?.payload})`)
  return { failed: true }
}

const apiCall = async (asyncFunc, { username, password }, payload, uploadId, traceId, logger) => {
  try {
    const headers = {
      Authorization: 'Basic ' + Buffer.from(username + ':' + password).toString('base64'),
      'content-type': 'application/json'
    }

    if (traceId) {
      headers[config.get('tracing.header')] = traceId
    }

    const r = { json: 'strict', headers }
    if (payload) {
      r.payload = payload
    }
    logger.debug(`ReferenceNumber: ${uploadId} -- Sending to Bulk API: ${JSON.stringify(payload)}`)
    const response = await asyncFunc(r)
    logger.debug(`ReferenceNumber: ${uploadId} -- Result from Bulk API (status): ${JSON.stringify(response.payload)}`)
    return response.payload
  } catch (e) {
    const statusCode = e.output?.statusCode
    logger.error(`ReferenceNumber: ${uploadId} -- ERROR calling bulk import api (status: ${statusCode}) ${formatErrorDetail(e)}`)
    if (statusCode === HTTP_BAD_REQUEST) {
      return extractValidationErrors(e, uploadId, logger)
    }
    if (TRANSIENT_STATUS_CODES.has(statusCode)) {
      throw e
    }
    return { failed: true }
  }
}

const urlFor = (bulkUploadId, conf, logger) => {
  try {
    const u = conf.endpoint.replace(/\/$/, '')
    return u + pathTo(conf.url, { bulkUploadId })
  } catch (e) {
    logger.error(`ReferenceNumber: ${bulkUploadId} -- Error generating bulk endpoint url ${conf}`)
    throw e
  }
}

const bulkRequest = async (method, bulkUploadId, movements, traceId, conf, logger) => {
  const c = conf ?? config.get('bulkUpload')
  const url = urlFor(bulkUploadId, c, logger)
  return apiCall((r) => wreck[method](url, r), c.basicAuth, movements, bulkUploadId, traceId, logger)
}

export const bulkImport = (id, movements, traceId, logger, conf) => bulkRequest('post', id, movements, traceId, conf, logger)
export const bulkUpdate = (id, movements, traceId, logger, conf) => bulkRequest('put', id, movements, traceId, conf, logger)

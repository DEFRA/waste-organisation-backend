import wreck from '@hapi/wreck'
import { config } from '../config.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { pathTo } from '../config/paths.js'

const logger = createLogger()

const HTTP_BAD_REQUEST = 400
const HTTP_REQUEST_TIMEOUT = 408
const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_BAD_GATEWAY = 502
const HTTP_SERVICE_UNAVAILABLE = 503

const TRANSIENT_STATUS_CODES = new Set([HTTP_REQUEST_TIMEOUT, HTTP_TOO_MANY_REQUESTS, HTTP_BAD_GATEWAY, HTTP_SERVICE_UNAVAILABLE])

const apiCall = async (asyncFunc, { username, password }, payload, uploadId) => {
  try {
    const headers = { Authorization: 'Basic ' + Buffer.from(username + ':' + password).toString('base64'), 'content-type': 'application/json' }
    const r = { json: 'strict', headers }
    if (payload) {
      r.payload = payload
    }
    logger.debug(`UploadId: ${uploadId} -- Sending to Bulk API: ${JSON.stringify(payload)}`)
    const response = await asyncFunc(r)
    logger.debug(`UploadId: ${uploadId} -- Result from Bulk API (status): ${JSON.stringify(response.payload)}`)
    return response.payload
  } catch (e) {
    const statusCode = e.output?.statusCode
    logger.error(`UploadId: ${uploadId} -- ERROR calling bulk import api (status: ${statusCode}) ${e}`)
    if (statusCode === HTTP_BAD_REQUEST) {
      logger.debug(`UploadId: ${uploadId} -- Validation errors processing spreadsheet ${e.data}`)
      const errors = e.data.payload.flatMap((v) => v?.validation?.errors || [])
      return { errors }
    }
    if (TRANSIENT_STATUS_CODES.has(statusCode)) {
      throw e
    }
    return { failed: true }
  }
}

const urlFor = (bulkUploadId, conf) => {
  try {
    const u = conf.endpoint.replace(/\/$/, '')
    return u + pathTo(conf.url, { bulkUploadId })
  } catch (e) {
    logger.error(`UploadId: ${bulkUploadId} -- Error generating bulk endpoint url ${conf}`)
    throw e
  }
}

const bulkRequest = async (method, bulkUploadId, movements, conf) => {
  const c = conf ?? config.get('bulkUpload')
  const url = urlFor(bulkUploadId, c)
  return apiCall((r) => wreck[method](url, r), c.basicAuth, movements, bulkUploadId)
}

export const bulkImport = (id, movements, conf) => bulkRequest('post', id, movements, conf)
export const bulkUpdate = (id, movements, conf) => bulkRequest('put', id, movements, conf)

import wreck from '@hapi/wreck'
import { config } from '../config.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { pathTo } from '../config/paths.js'

const logger = createLogger()

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
    logger.error(`UploadId: ${uploadId} -- ERROR calling bulk import api ${e}`)
    // prettier-ignore
    if (e.output.statusCode === 400) { // nosonar
      logger.debug(`UploadId: ${uploadId} -- Validation errors processing spreadsheet ${e.data}`)
      const errors = e.data.payload.flatMap((v) => v.validation.errors)
      return { errors }
    } else {
      throw e
    }
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

export const bulkImport = async (bulkUploadId, movements, conf) => {
  const c = conf ?? config.get('bulkUpload')
  const url = urlFor(bulkUploadId, c)
  const response = await apiCall((r) => wreck.post(url, r), c.basicAuth, movements, bulkUploadId)
  return response
}

export const bulkUpdate = async (bulkUploadId, movements, conf) => {
  const c = conf ?? config.get('bulkUpload')
  const url = urlFor(bulkUploadId, c)
  const response = await apiCall((r) => wreck.put(url, r), c.basicAuth, movements, bulkUploadId)
  return response
}

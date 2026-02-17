import wreck from '@hapi/wreck'
import { config } from '../config.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { pathTo } from '../config/paths.js'

const logger = createLogger()

const apiCall = async (asyncFunc, { username, password }, payload) => {
  try {
    const headers = { Authorization: 'Basic ' + Buffer.from(username + ':' + password).toString('base64'), 'content-type': 'application/json' }
    const r = { json: 'strict', headers }
    if (payload) {
      r.payload = payload
    }
    const response = await asyncFunc(r)
    return response.payload
  } catch (e) {
    logger.error(`ERROR calling bulk import api ${e}`)
    if (e.output.statusCode === 400) {
      const errors = e.data.payload.flatMap((v) => v.validation.errors)
      logger.info(`Info Validation errors processing spreadsheet`)
      return { errors }
    } else {
      throw e
    }
  }
}

const urlFor = (bulkUploadId, conf) => {
  const u = conf.endpoint.replace(/\/$/, '')
  return u + pathTo(conf.url, { bulkUploadId })
}

export const bulkImport = async (bulkUploadId, movements, conf) => {
  const c = conf ?? config.get('bulkUpload.endpoint')
  const url = urlFor(bulkUploadId, c)
  const response = await apiCall((r) => wreck.post(url, r), c.basicAuth, movements)
  return response
}

import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import jwt from 'jsonwebtoken'
import wreck from '@hapi/wreck'

const govPayUrl = 'https://api.notifications.service.gov.uk'

const createGovukNotifyToken = ({ apiKeyId, serviceId }) => {
  if (apiKeyId && serviceId) {
    return jwt.sign({ iss: serviceId, iat: Math.round(Date.now() / 1000) }, apiKeyId, { header: { typ: 'JWT', alg: 'HS256' } })
  } else {
    throw new Error('Notify key not set')
  }
}

const parseGovNotifyKey = () => {
  const apiKey = config.get('notify.govNotifyKey')
  const apiKeyId = apiKey?.substring(apiKey.length - 36, apiKey.length)
  const serviceId = apiKey?.substring(apiKey.length - 73, apiKey.length - 37)
  return { apiKeyId, serviceId }
}

const prepareUpload = (file) => {
  if (file.length > 2 * 1024 * 1024) {
    throw new Error('File is larger than 2MB.')
  }
  // if (typeof file === 'string') {
  //   file = Buffer.from(file)
  // }
  return {
    file: file.toString('base64'),
    filename: null,
    confirm_email_before_download: null,
    retention_period: null
  }
}

const successTemplate = config.get('notify.successTemplate')
const failedTemplate = config.get('notify.failedTemplate')
const failedWithFileTemplate = config.get('notify.failedWithFileTemplate')
export const sendEmail = {
  sendSuccess: async ({ email, name, file, referenceNumber, filename, logger }) =>
    send({ template: successTemplate, email, name, file, referenceNumber, filename, logger }),
  sendFailed: async ({ email, name, referenceNumber, filename, logger }) => send({ template: failedTemplate, email, name, referenceNumber, filename, logger }),
  sendValidationFailed: async ({ email, name, file, referenceNumber, filename, logger }) =>
    send({ template: failedWithFileTemplate, email, name, file, referenceNumber, filename, logger })
}

const send = async ({ template, email, name, file, referenceNumber, filename, logger }) => {
  if (!logger) {
    logger = createLogger()
  }
  let nameObject = null

  try {
    if (name) {
      nameObject = JSON.parse(name)
    }
  } catch (error) {
    logger.error(`name is not parsable to JSON: ${error}`)
  }
  try {
    const personalisation = {
      'first name': nameObject ? nameObject.firstName : null,
      'upload id': referenceNumber ?? null,
      filename: filename ?? null
    }
    if (file) {
      logger.info(`Attaching file`)
      personalisation.link_to_file = prepareUpload(file)
    }
    const response = await wreck.post(`${govPayUrl}/v2/notifications/email`, {
      json: 'strict',
      headers: {
        Authorization: 'Bearer ' + createGovukNotifyToken(parseGovNotifyKey())
      },
      payload: { email_address: email, template_id: template, personalisation }
    })
    logger.info(`Email Sent`)
    return response
  } catch (err) {
    logger.error(`Error sending emails: ${err}`)
    return null
  }
}

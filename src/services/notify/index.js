import { NotifyClient } from 'notifications-node-client'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
const apiKey = config.get('notify.govNotifyKey')

const successTemplate = config.get('notify.successTemplate')
const failedTemplate = config.get('notify.failedTemplate')
const failedWithFileTemplate = config.get('notify.failedWithFileTemplate')
export const sendEmail = {
  sendSuccess: async ({ email, name, file, referenceNumber, logger }) => send({ template: successTemplate, email, name, file, referenceNumber, logger }),
  sendFailed: async ({ email, name, referenceNumber, logger }) => send({ template: failedTemplate, email, name, referenceNumber, logger }),
  sendValidationFailed: async ({ email, name, file, referenceNumber, logger }) =>
    send({ template: failedWithFileTemplate, email, name, file, referenceNumber, logger })
}

const send = async ({ template, email, name, file, referenceNumber, logger }) => {
  if (!logger) {
    logger = createLogger()
  }

  const notifyClient = new NotifyClient(apiKey)
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
      'upload id': referenceNumber ?? null
    }
    if (file) {
      logger.info(`Attaching file`)
      personalisation.link_to_file = notifyClient.prepareUpload(file)
    }
    const response = await notifyClient.sendEmail(template, email, { personalisation })
    logger.info(`Email Sent`)
    return response
  } catch (err) {
    logger.error(`Error sending emails: ${err}`)
    return null
  }
}

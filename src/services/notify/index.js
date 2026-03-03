import { NotifyClient } from 'notifications-node-client'

import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
const apiKey = config.get('notify.govNotifyKey')

const successTemplate = config.get('notify.successTemplate')
const failedTemplate = config.get('notify.failedTemplate')
const failedWithFileTemplate = config.get('notify.failedWithFileTemplate')

const logger = createLogger()

export const sendEmail = {
  sendSuccess: async ({ email, name, file }) => send(successTemplate, email, name, file),
  sendFailed: async ({ email, name }) => send(failedTemplate, email, name),
  sendValidationFailed: async ({ email, name, file }) => send(failedWithFileTemplate, email, name, file)
}

const send = async (template, email, name, file) => {
  const notifyClient = new NotifyClient(apiKey)
  try {
    const personalisation = {
      'first name': name.firstName
    }
    if (file) {
      logger.info(`Attaching file`)
      personalisation.link_to_file = notifyClient.prepareUpload(file)
    }

    const response = await notifyClient.sendEmail(template, email, { personalisation })
    //   // TODO write the email response into the mongo db record for later debugging (not in prod - don't store PII)

    logger.info(`Email Response data: ${response?.data}`)
    return response
  } catch (err) {
    logger.error(`Error sending emails: ${err}`)
  }
}

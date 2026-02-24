import { NotifyClient } from 'notifications-node-client'

import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
const apiKey = config.get('notify.govNotifyKey')

const successTemplate = config.get('notify.successTemplate')
const failedTemplate = config.get('notify.failedTemplate')
const failedWithFileTemplate = config.get('notify.failedWithFileTemplate')

const logger = createLogger()

export const sendEmail = {
  sendSuccess: async ({ email, file }) => send(successTemplate, email, file),
  sendFailed: async ({ email }) => send(failedTemplate, email),
  sendValidationFailed: async ({ email, file }) => send(failedWithFileTemplate, email, file)
}

const send = async (template, email, file) => {
  const notifyClient = new NotifyClient(apiKey)
  try {
    const personalisation = {
      'first name': 'Joe Bloggs'
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

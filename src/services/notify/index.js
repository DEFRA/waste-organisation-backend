import { NotifyClient } from 'notifications-node-client'

import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
const apiKey = config.get('notify.govNotifyKey')

const formatValidationFailed = '8ad2881f-4904-4c22-a0fb-b001d8d72349'
const dataValidationFailed = 'e6f9eb36-c2cc-4838-b7ae-1e79847afdd6'
const successfulSubmission = '2ffe3792-f097-421d-b3e2-9de5af81609f'

const logger = createLogger()

export const sendEmail = {
  sendSuccess: async ({ email, file }) => send(successfulSubmission, email, file),
  sendFailed: async ({ email, file }) => send(formatValidationFailed, email, file),
  sendValidationFailed: async ({ email, file }) => send(dataValidationFailed, email, file)
}

const send = async (template, email, file) => {
  const notifyClient = new NotifyClient(apiKey)
  try {
    const personalisation = {
      'first name': 'Joe Bloggs'
    }
    if (file) {
      personalisation.link_to_file = notifyClient.prepareUpload(file)
    }

    const response = await notifyClient.sendEmail(template, email, { personalisation })
    //   // TODO write the email response into the mongo db record for later debugging (not in prod - don't store PII)

    logger.info(`Email Response ${response}`)
    return response
  } catch (err) {
    logger.error(`Error sending emails: ${err}`)
  }
}

import { NotifyClient } from 'notifications-node-client'

import { config } from '../../config'
const apiKey = config.get('notify.govNotifyKey')

const formatValidationFailed = '8ad2881f-4904-4c22-a0fb-b001d8d72349'
const dataValidationFailed = 'e6f9eb36-c2cc-4838-b7ae-1e79847afdd6'
const successfulSubmission = '2ffe3792-f097-421d-b3e2-9de5af81609f'

export const sendEmail = {
  sendSuccess: async ({ email }) => send(successfulSubmission, email),
  sendFailed: async ({ email }) => send(formatValidationFailed, email),
  sendValidationFailed: async ({ email }) => send(dataValidationFailed, email)
}

const send = async (template, email) => {
  const notifyClient = new NotifyClient(apiKey)
  return await notifyClient.sendEmail(template, email)
}

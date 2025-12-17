import {
  ServiceBusClient // ServiceBusMessage
} from '@azure/service-bus'
// import {DefaultAzureCredential} from '@azure/identity'
import { createLogger } from './common/helpers/logging/logger.js'

// TODO keep event sourced data in s3 bucket
// TODO tidy up example and process actual data structures

export const connectionStr =
  'Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;'

// name of the queue
export const queueName = 'queue.1'

const logger = createLogger()

const msgErrorHandler = async (error) => {
  logger.log(error)
}

export const listenForDefraIdMessages = (messageHandler) => {
  const sbClient = new ServiceBusClient(connectionStr)
  const receiver = sbClient.createReceiver(queueName)

  logger.info('Starting DEFRA ID listener')
  // subscribe and specify the message and error handlers
  receiver.subscribe({
    processMessage: messageHandler,
    processError: msgErrorHandler
  })

  return {
    close: async () => {
      logger.info('Shutting down DEFRA ID listener')
      await receiver.close()
      await sbClient.close()
    }
  }
}

export const messageHandler = async (message) => {
  return message
}

import {
  ServiceBusClient // ServiceBusMessage
} from '@azure/service-bus'
// import {DefaultAzureCredential} from '@azure/identity'
import { MongoClient } from 'mongodb'
import { createLogger } from './common/helpers/logging/logger.js'
import { saveOrganisation } from './repositories/organisation.js'

// TODO keep event sourced data in s3 bucket
// TODO tidy up example and process actual data structures
// TODO add db lock to messageHandler
// TODO persist connection id -> contact id relationship

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
  receiver.subscribe({
    processMessage: messageHandler.handleMessage,
    processError: msgErrorHandler
  })

  return {
    close: async () => {
      logger.info('Shutting down DEFRA ID listener')
      await receiver.close()
      await sbClient.close()
      if (messageHandler.close) {
        await messageHandler.close()
      }
    }
  }
}

export const dbMessageHandler = async (transform, options) => {
  const client = await MongoClient.connect(options.mongoUrl, {
    ...options.mongoOptions
  })

  const databaseName = options.databaseName
  const db = client.db(databaseName)

  return {
    close: async () => {
      await db.close(true)
    },
    handleMessage: async (message) => {
      // const dbOrg =
      const org = transform(message)
      if (org) {
        saveOrganisation(db, org.organisationId, org)
      }
    }
  }
}

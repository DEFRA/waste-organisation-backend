// import { spreadsheetSchema } from '../domain/spreadsheet.js'
// import { mergeAndValidate } from '../domain/index.js'
// import { updateWithOptimisticLock } from '../repositories/index.js'
// import { spreadsheetCollection } from '../repositories/spreadsheet.js'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs'
import { config } from './config.js'
import { createLogger } from './common/helpers/logging/logger.js'
import { parseExcelFile } from './services/spreadsheetImport.js'

const logger = createLogger()

const constructS3Client = () => {
  return new S3Client({
    region: config.get('aws.region'),
    endpoint: config.get('aws.s3Endpoint'),
    forcePathStyle: config.get('aws.forcePathStyle')
  })
}

export const fetchS3Object = async (s3Client, Bucket, Key) => {
  const request = new GetObjectCommand({
    Bucket,
    Key,
    ChecksumMode: config.get('aws.checksumMode')
  })
  const response = await s3Client.send(request)
  const stream = await response.Body
  const chunks = []
  for await (const c of stream) {
    chunks.push(c)
  }
  return Buffer.concat(chunks)
}

const constructSqsClient = () => {
  return new SQSClient({
    region: config.get('aws.region'),
    endpoint: config.get('aws.sqsEndpoint')
  })
}

export const deleteMessage = async (client, QueueUrl, receiptHandle) => {
  const params = {
    QueueUrl,
    ReceiptHandle: receiptHandle
  }

  try {
    const command = new DeleteMessageCommand(params)
    await client.send(command)
    logger.info(`Message deleted from queue with handle ${receiptHandle}`)
  } catch (err) {
    logger.error(`Error deleting message: ${err}`)
  }
}

/* v8 ignore start */
// TODO write some tests for this
export const processJob = async (s3Client, message) => {
  logger.info(`Message: ${JSON.stringify(message)}`)
  const { s3Bucket, s3Key } = JSON.parse(message.Body)
  if (s3Key && s3Bucket) {
    const buffer = await fetchS3Object(s3Client, s3Bucket, s3Key)
    logger.info(`Fetching bytes: ${buffer.length}`)
    const workbook = await parseExcelFile(buffer)
    return workbook
  } else {
    logger.info(`Message missing s3 coords: ${JSON.stringify(message)}`)
    return null
  }
}
/* v8 ignore stop */

export const pollQueue = async ({ sqsClient, QueueUrl, action }) => {
  const params = {
    QueueUrl,
    MaxNumberOfMessages: 10, // Process up to 10 messages at once
    WaitTimeSeconds: 20, // Long polling to reduce empty responses
    VisibilityTimeout: 30 // Hide message for 30s while processing
  }

  try {
    const command = new ReceiveMessageCommand(params)
    const data = await sqsClient.send(command)

    if (data.Messages && data.Messages.length > 0) {
      logger.info(`Received ${data.Messages.length} message(s)`)

      // Process messages in parallel
      await Promise.all(
        data.Messages.map(async (message) => {
          try {
            await action(message)
            // Delete message after successful processing
            await deleteMessage(sqsClient, QueueUrl, message.ReceiptHandle)
          } catch (err) {
            // Message will become visible again after VisibilityTimeout
            logger.error(`Error processing message: ${err}`)
          }
        })
      )
    } else {
      logger.debug('No messages in queue')
    }
  } catch (err) {
    logger.error(`Error polling queue: ${err}`)
  }
}

export const startWorker = async () => {
  logger.info('Worker started. Polling for jobs...')
  const QueueUrl = config.get('aws.backgroundProcessQueue')
  const s3Client = constructS3Client()
  const sqsClient = constructSqsClient()
  // prettier-ignore
  while (true) {  // NOSONAR
    await pollQueue({
      sqsClient,
      QueueUrl,
      action: async (message) => await processJob(s3Client, message)
    })
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

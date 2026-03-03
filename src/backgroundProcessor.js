// import { spreadsheetSchema } from '../domain/spreadsheet.js'
// import { mergeAndValidate } from '../domain/index.js'
// import { updateWithOptimisticLock } from '../repositories/index.js'
// import { spreadsheetCollection } from '../repositories/spreadsheet.js'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs'
import { config } from './config.js'
import { createLogger } from './common/helpers/logging/logger.js'
import {
  parseExcelFile,
  workbookToByteArray,
  transformBulkApiErrors,
  updateErrors,
  validateWasteTrackingIds,
  validateNoWasteTrackingIds,
  wasteTrackingIdsToCoords,
  updateCellContent
} from './services/spreadsheetImport.js'
import { decrypt } from './services/decrypt.js'
import { sendEmail } from './services/notify/index.js'
import { bulkImport, bulkUpdate } from './services/bulkImport.js'

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

const sendInitalFailedEmail = async (workbook, decryptedEmail, decryptedName) => {
  if (workbook) {
    const file = await workbookToByteArray(workbook)
    logger.info(`sending validation failed message ${file ? 'with file' : 'without file'}`)
    await sendEmail.sendValidationFailed({ email: decryptedEmail, name: decryptedName, file })
  } else {
    await sendEmail.sendFailed({ email: decryptedEmail, name: decryptedName })
  }
}

const processSpreadsheet = async (s3Client, { s3Bucket, s3Key, organisationId, uploadId, uploadType }, decryptedEmail, decryptedName) => {
  const buffer = await fetchS3Object(s3Client, s3Bucket, s3Key)
  logger.info(`UploadId: ${uploadId} -- Fetching bytes: ${buffer.length}`)
  const { hasErrors, workbook, movements, rowNumbers, errors } = await parseExcelFile(buffer, organisationId)
  if (hasErrors) {
    logger.warn(`UploadId: ${uploadId} -- Errors before sending to import API ${JSON.stringify(errors)}`)
    await sendInitalFailedEmail(workbook, decryptedEmail, decryptedName)
    return
  }

  const isUpdate = uploadType === 'update'
  const wtidErrors = isUpdate ? validateWasteTrackingIds(movements, rowNumbers) : validateNoWasteTrackingIds(movements, rowNumbers)

  if (wtidErrors.length > 0) {
    logger.warn(`UploadId: ${uploadId} -- Waste Tracking ID validation errors ${JSON.stringify(wtidErrors)}`)
    updateErrors(workbook, { [wtidErrors[0].sheet]: wtidErrors })
    const file = await workbookToByteArray(workbook)
    await sendEmail.sendValidationFailed({ email: decryptedEmail, name: decryptedName, file })
    return
  }

  const apiResponse = isUpdate ? await bulkUpdate(uploadId, movements) : await bulkImport(uploadId, movements)

  if (apiResponse.failed) {
    await sendEmail.sendFailed({ email: decryptedEmail })
    return
  }

  if (apiResponse.errors) {
    logger.warn(`UploadId: ${uploadId} -- Errors from import API ${JSON.stringify(apiResponse.errors)}`)
    const errs = transformBulkApiErrors(movements, rowNumbers, apiResponse.errors)
    logger.debug(`UploadId: ${uploadId} -- Cells to update with errors: ${JSON.stringify(errs)}`)
    updateErrors(workbook, errs)
    const file = await workbookToByteArray(workbook)
    await sendEmail.sendValidationFailed({ email: decryptedEmail, name: decryptedName, file })
    return
  }

  if (apiResponse.movements) {
    logger.debug(`UploadId: ${uploadId} -- Movements returned from Bulk API`)
    const coords = wasteTrackingIdsToCoords(movements, rowNumbers, apiResponse.movements)
    logger.debug(`UploadId: ${uploadId} -- Cells to update with waste tracking ids: ${JSON.stringify(coords)}`)
    updateCellContent(workbook, coords)
    const file = await workbookToByteArray(workbook)
    await sendEmail.sendSuccess({ email: decryptedEmail, name: decryptedName, file })
    return
  }
  logger.error(`UploadId: ${uploadId} -- Unhandled case. No errors or waste tracking ids generated for ${uploadId}`)
}

export const processJob = async (s3Client, message) => {
  logger.info(`Message: ${JSON.stringify(message)}`)
  const { s3Bucket, s3Key, encryptedEmail, encryptedName, organisationId, uploadId, uploadType, hasError } = JSON.parse(message.Body)
  const decryptedEmail = decrypt(encryptedEmail, config.get('encryptionKey'))
  const decryptedName = decrypt(encryptedName, config.get('encryptionKey'))

  if (hasError) {
    await sendEmail.sendFailed({ email: decryptedEmail, name: decryptedName })
    return
  }

  if (!s3Key || !s3Bucket) {
    logger.info(`Message missing s3 coords: ${JSON.stringify(message)}`)
    return
  }
  await processSpreadsheet(s3Client, { s3Bucket, s3Key, organisationId, uploadId, uploadType }, decryptedEmail, decryptedName)
}

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
            logger.error(`Error processing message: ${err.stack}`)
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

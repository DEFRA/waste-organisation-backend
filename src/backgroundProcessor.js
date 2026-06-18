// import { spreadsheetSchema } from '../domain/spreadsheet.js'
// import { mergeAndValidate } from '../domain/index.js'
// import { updateWithOptimisticLock } from '../repositories/index.js'
// import { spreadsheetCollection } from '../repositories/spreadsheet.js'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs'
import { constructSqsClient } from './plugins/sqs.js'
import { MongoClient } from 'mongodb'

import { config } from './config.js'
import { createLogger } from './common/helpers/logging/logger.js'
import {
  parseExcelFile,
  workbookToByteArray,
  transformBulkApiErrors,
  updateErrors,
  wasteTrackingIdsToCoords,
  updateCellContent
} from './services/spreadsheetImport.js'
import { decrypt } from './services/decrypt.js'
import { sendEmail } from './services/notify/index.js'
import { bulkImport, bulkUpdate } from './services/bulkImport.js'
import { TRANSIENT_STATUS_CODES } from './services/httpStatusCodes.js'
import { validateWasteTrackingIdExists, validateWasteTrackingIdMissing } from './services/spreadsheetImport/transforms.js'
import { getPaymentStatus } from './services/govPay/index.js'
import { updateOrganisationPaymentStatus } from './domain/organisation.js'
import { updateFromGovPayEvent, hasStatusChanged, isPending } from './domain/payment.js'
import { updateWithOptimisticLock } from './repositories/index.js'
import { paymentCollection } from './repositories/payment.js'
import { orgCollection } from './repositories/organisation.js'

const defaultLogger = createLogger()

export const constructS3Client = () => {
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

export const constructMongoClient = async () => {
  const options = config.get('mongo')
  const client = await MongoClient.connect(options.mongoUrl, {
    ...options.mongoOptions
  })
  return client.db(options.databaseName)
}

export const deleteMessage = async (client, QueueUrl, receiptHandle, logger) => {
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

const storeProcessedFile = async (s3Client, s3Bucket, s3Key, file) => {
  if (!config.get('isTestRoutesEnabled')) {
    return
  }
  await s3Client.send(
    new PutObjectCommand({
      Bucket: s3Bucket,
      Key: `${s3Key}-processed`,
      Body: file
    })
  )
}

const sendInitialFailedEmail = async ({ s3Client, s3Bucket, s3Key, workbook, decryptedEmail, decryptedName, referenceNumber, filename, logger }) => {
  if (workbook) {
    const file = await workbookToByteArray(workbook)
    await storeProcessedFile(s3Client, s3Bucket, s3Key, file)
    logger.info(`sending validation failed message ${file ? 'with file' : 'without file'}`)
    await sendEmail.sendValidationFailed({ email: decryptedEmail, name: decryptedName, file, referenceNumber, filename })
  } else {
    await sendEmail.sendFailed({ email: decryptedEmail, name: decryptedName, referenceNumber, filename })
  }
}

const processSpreadsheet = async (
  s3Client,
  { s3Bucket, s3Key, organisationId, referenceNumber, uploadType, filename },
  decryptedEmail,
  decryptedName,
  traceId,
  logger
) => {
  const buffer = await fetchS3Object(s3Client, s3Bucket, s3Key)
  logger.info(`ReferenceNumber: ${referenceNumber} -- Fetching bytes: ${buffer.length}`)
  const isUpdate = uploadType === 'update'
  const validatorFn = isUpdate ? validateWasteTrackingIdExists : validateWasteTrackingIdMissing
  const { hasErrors, workbook, movements, rowNumbers, errors } = await parseExcelFile(buffer, organisationId, logger, validatorFn)
  if (hasErrors) {
    logger.warn(`ReferenceNumber: ${referenceNumber} -- Errors before sending to import API ${JSON.stringify(errors)}`)
    await sendInitialFailedEmail({ s3Client, s3Bucket, s3Key, workbook, decryptedEmail, decryptedName, referenceNumber, filename, logger })
    return
  }

  const apiResponse = isUpdate ? await bulkUpdate(referenceNumber, movements, traceId, logger) : await bulkImport(referenceNumber, movements, traceId, logger)

  if (apiResponse.failed) {
    await sendEmail.sendFailed({ email: decryptedEmail, name: decryptedName, referenceNumber, filename })
    return
  }

  if (apiResponse.errors) {
    logger.warn(`ReferenceNumber: ${referenceNumber} -- Errors from import API ${JSON.stringify(apiResponse.errors)}`)
    logger.debug(`ReferenceNumber: ${referenceNumber} -- rowNumbers: ${JSON.stringify(rowNumbers)}`)
    const errs = transformBulkApiErrors(movements, rowNumbers, apiResponse.errors)
    logger.debug(`ReferenceNumber: ${referenceNumber} -- Cells to update with errors: ${JSON.stringify(errs)}`)
    updateErrors(workbook, errs)
    const file = await workbookToByteArray(workbook)
    await storeProcessedFile(s3Client, s3Bucket, s3Key, file)
    await sendEmail.sendValidationFailed({ email: decryptedEmail, name: decryptedName, file, referenceNumber, filename })
    return
  }

  if (apiResponse.movements) {
    logger.debug(`ReferenceNumber: ${referenceNumber} -- Movements returned from Bulk API`)
    if (!isUpdate) {
      const coords = wasteTrackingIdsToCoords(movements, rowNumbers, apiResponse.movements)
      logger.debug(`ReferenceNumber: ${referenceNumber} -- Cells to update with waste tracking ids: ${JSON.stringify(coords)}`)
      updateCellContent(workbook, coords)
    }
    const file = await workbookToByteArray(workbook)
    await storeProcessedFile(s3Client, s3Bucket, s3Key, file)
    logger.info(`ReferenceNumber: ${referenceNumber} organisationId: ${organisationId} - ${movements.length} waste movement records created successfully`)
    await sendEmail.sendSuccess({ email: decryptedEmail, name: decryptedName, file, referenceNumber, filename })
    return
  }
  logger.error(`ReferenceNumber: ${referenceNumber} -- Unhandled case. No errors or waste tracking ids generated for ${referenceNumber}`)
}

export const processSpreadsheetJob = async (s3Client, message) => {
  const { s3Bucket, s3Key, encryptedEmail, encryptedName, organisationId, uploadId, uploadType, hasError, referenceNumber, filename, traceId } = message
  const processJobLogger = createLogger(traceId)
  processJobLogger.info(`Message: ${JSON.stringify(message)}`)
  const decryptedEmail = decrypt(encryptedEmail, config.get('encryptionKey'))
  const decryptedName = decrypt(encryptedName, config.get('encryptionKey'))

  const emailReferenceNumber = referenceNumber ?? uploadId

  if (hasError) {
    await sendEmail.sendFailed({ email: decryptedEmail, name: decryptedName, referenceNumber: emailReferenceNumber, filename, logger: processJobLogger })
    return { logger: processJobLogger }
  }

  if (!s3Key || !s3Bucket) {
    processJobLogger.info(`Message missing s3 coords: ${JSON.stringify(message)}`)
    return { logger: processJobLogger }
  }
  try {
    await processSpreadsheet(
      s3Client,
      { s3Bucket, s3Key, organisationId, referenceNumber: emailReferenceNumber, uploadType, filename },
      decryptedEmail,
      decryptedName,
      traceId,
      processJobLogger
    )
  } catch (e) {
    const statusCode = e.output?.statusCode
    if (TRANSIENT_STATUS_CODES.has(statusCode)) {
      throw e
    }
    processJobLogger.error(`ReferenceNumber: ${emailReferenceNumber} -- Unexpected error processing spreadsheet: ${e.stack}`)
    await sendEmail.sendFailed({ email: decryptedEmail, name: decryptedName, referenceNumber: emailReferenceNumber, filename, logger: processJobLogger })
  }
  return { logger: processJobLogger }
}

const updatePaymentStatus = async (paymentId, organisationId, govPayment, db) => {
  let shouldUpdateOrg = false
  let organisation = null
  const payment = await updateWithOptimisticLock(db.collection(paymentCollection), { paymentId, organisationId }, (dbPayment) => {
    if (dbPayment.status) {
      const p = updateFromGovPayEvent(dbPayment, govPayment)
      shouldUpdateOrg = hasStatusChanged(dbPayment, p)
      return p
    } else {
      return null
    }
  })
  if (shouldUpdateOrg) {
    organisation = await updateWithOptimisticLock(db.collection(orgCollection), { organisationId }, (org) => updateOrganisationPaymentStatus(org, payment))
  }
  return { payment, organisation }
}

export const processPaymentJob = async (db, message) => {
  const { paymentId, organisationId, traceId } = message
  const processJobLogger = createLogger(traceId)
  const govPayment = await getPaymentStatus(paymentId, processJobLogger)
  const { payment } = await updatePaymentStatus(paymentId, organisationId, govPayment.payload, db)
  return { logger: processJobLogger, payment, skipDeleteMessage: isPending(payment) }
}

export const dispatchProcessJob = (s3Client, mongoClient) => async (message) => {
  const m = JSON.parse(message.Body)
  if (m.uploadId) {
    return await processSpreadsheetJob(s3Client, m)
  }
  if (m.paymentId) {
    return await processPaymentJob(mongoClient, m)
  }
  return null
}

export const pollQueue = async ({ sqsClient, QueueUrl, action }) => {
  const params = {
    QueueUrl,
    MaxNumberOfMessages: 1, // Process 1 messages at once
    WaitTimeSeconds: 20, // Long polling to reduce empty responses
    VisibilityTimeout: 300 // Hide message while processing
  }

  try {
    const command = new ReceiveMessageCommand(params)
    const data = await sqsClient.send(command)

    if (data.Messages && data.Messages.length > 0) {
      defaultLogger.info(`Received ${data.Messages.length} message(s)`)
      const message = data.Messages[0] // Assumes batch size is 1 - see MaxNumberOfMessages above
      try {
        const result = await action(message)
        // Delete message after successful processing
        const lg = result?.logger || defaultLogger
        if (result.skipDeleteMessage) {
          lg.info(`Skipping deleting message ${message}`)
        } else {
          await deleteMessage(sqsClient, QueueUrl, message.ReceiptHandle, lg)
        }
      } catch (err) {
        // Message will become visible again after VisibilityTimeout
        defaultLogger.error(`Error processing message: ${err.stack}`)
      }
    } else {
      defaultLogger.debug('No messages in queue')
    }
  } catch (err) {
    defaultLogger.error(`Error polling queue: ${err}`)
  }
}

export const startWorker = async () => {
  defaultLogger.info('Worker started. Polling for jobs...')
  const QueueUrl = config.get('aws.backgroundProcessQueue')
  const s3Client = constructS3Client()
  const sqsClient = constructSqsClient({
    region: config.get('aws.region'),
    endpoint: config.get('aws.sqsEndpoint')
  })
  const mongoClient = await constructMongoClient()
  // prettier-ignore
  while (true) {  // NOSONAR
    await pollQueue({
      sqsClient,
      QueueUrl,
      action: dispatchProcessJob(s3Client, mongoClient)
    })
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

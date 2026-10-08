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
import { workbookToByteArray, transformBulkApiErrors, updateErrors, wasteTrackingIdsToCoords, updateCellContent } from './services/spreadsheetImport.js'
import { readExcelBuffer } from './services/spreadsheetImport/excel.js'
import { getWorksheetMeta } from './services/spreadsheetImport/worksheetMetadata.js'
import { downloadAndParseSpreadsheetInSandbox } from './services/spreadsheetSandbox.js'
import { decrypt } from './services/decrypt.js'
import { sendEmail } from './services/notify/index.js'
import { bulkImport, bulkUpdate } from './services/bulkImport.js'
import { TransientApiError, PermanentApiError } from './common/helpers/exceptions.js'
import { getPaymentStatus, getRefundsBetween } from './services/govPay/index.js'
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

const sendInitialFailedEmail = async ({ s3Client, s3Bucket, s3Key, file, decryptedEmail, decryptedName, referenceNumber, filename, organisationId, logger }) => {
  logger.info(`GRAFANA_REPORT >> spreadsheet_submission_processed >> failed `, {
    organisationId,
    referenceNumber,
    spreadsheetRejectionReasion: file ? 'CannotParseSpreadsheetContents' : 'CannotReadSpreadsheet'
  })
  if (file) {
    await storeProcessedFile(s3Client, s3Bucket, s3Key, file)
    logger.info(`sending validation failed message with file`)
    await sendEmail.sendValidationFailed({ email: decryptedEmail, name: decryptedName, file, referenceNumber, filename })
  } else {
    await sendEmail.sendFailed({ email: decryptedEmail, name: decryptedName, referenceNumber, filename })
  }
}

const handleApiResponseErrors = async ({ logger, organisationId, referenceNumber, apiResponse, rowNumbers, workbookBytes, movements, uploadType, s3Client, s3Bucket, s3Key, decryptedEmail, decryptedName, filename, logTime }) => {
  logger.info(`GRAFANA_REPORT >> spreadsheet_submission_processed >> failed `, {
    organisationId,
    referenceNumber,
    spreadsheetRejectionReasion: 'BulkImportApiReturnedValidationErrors'
  })
  logger.warn(`ReferenceNumber: ${referenceNumber} -- Errors from import API ${JSON.stringify(apiResponse.errors)}`)
  logger.debug(`ReferenceNumber: ${referenceNumber} -- rowNumbers: ${JSON.stringify(rowNumbers)}`)
  const workbook = await readExcelBuffer(Buffer.from(workbookBytes), logger)
  workbookBytes = null
  const worksheetMetadata = getWorksheetMeta(workbook, uploadType, organisationId, logger)
  const errs = transformBulkApiErrors(movements, rowNumbers, worksheetMetadata, apiResponse.errors)

  logger.debug(`ReferenceNumber: ${referenceNumber} -- Cells to update with errors: ${JSON.stringify(errs)}`)
  updateErrors(workbook, errs, worksheetMetadata, logger)

  workbookBytes = await workbookToByteArray(workbook, logger)
  await storeProcessedFile(s3Client, s3Bucket, s3Key, workbookBytes)

  await sendEmail.sendValidationFailed({ email: decryptedEmail, name: decryptedName, file: workbookBytes, referenceNumber, filename })
  logTime('apiResponse.errors')
}

const handleApiResponseMovements = async ({ logger, organisationId, referenceNumber, apiResponse, rowNumbers, workbookBytes, movements, uploadType, s3Client, s3Bucket, s3Key, decryptedEmail, decryptedName, filename, logTime, isUpdate }) => {
  logger.debug(`ReferenceNumber: ${referenceNumber} -- Movements returned from Bulk API`)
  const workbook = await readExcelBuffer(Buffer.from(workbookBytes), logger)
  workbookBytes = null
  if (!isUpdate) {
    const worksheetMetadata = getWorksheetMeta(workbook, uploadType, organisationId, logger)
    const coords = wasteTrackingIdsToCoords(movements, rowNumbers, apiResponse.movements, worksheetMetadata)
    logger.debug(`ReferenceNumber: ${referenceNumber} -- Cells to update with waste tracking ids: ${JSON.stringify(coords)}`)
    updateCellContent(workbook, coords, worksheetMetadata, logger)
  }
  workbookBytes = await workbookToByteArray(workbook, logger)
  await storeProcessedFile(s3Client, s3Bucket, s3Key, workbookBytes)
  logger.info(`ReferenceNumber: ${referenceNumber} organisationId: ${organisationId} - ${movements.length} waste movement records created successfully`)
  await sendEmail.sendSuccess({ email: decryptedEmail, name: decryptedName, file: workbookBytes, referenceNumber, filename })
  logTime('apiResponse.movements')
}

const processSpreadsheet = async (s3Client, { s3Bucket, s3Key, organisationId, referenceNumber, uploadType, filename }, decryptedEmail, decryptedName, traceId, logger) => {
  const startTime = performance.now()
  const logTime = (location) => {
    const endTime = performance.now()
    logger.info(`Total spreadsheet processing time (${location}): ${Math.ceil(endTime - startTime)} ms`)
  }

  /* Parse in a separate, resource-limited process so a poisoned file can't
  blow up the node's RAM/disk/CPU. */
  const isUpdate = uploadType === 'update'

  /* We time the sandbox here rather than in spreadsheetSandbox because it's a lot
  cleaner. We're off by up to a few ms, but it doesn't matter for our stats */
  const { hasErrors, errors, movements, rowNumbers, workbookBytes } = await downloadAndParseSpreadsheetInSandbox({ s3Bucket, s3Key, referenceNumber, organisationId, uploadType, traceId, logger })
  logTime('sandbox')

  if (hasErrors) {
    logger.warn(`ReferenceNumber: ${referenceNumber} -- Errors before sending to import API ${JSON.stringify(errors)}`)
    await sendInitialFailedEmail({ s3Client, s3Bucket, s3Key, file: workbookBytes, decryptedEmail, decryptedName, referenceNumber, filename, organisationId, logger })

    logTime('hasErrors')
    return
  }

  const apiResponse = isUpdate ? await bulkUpdate(referenceNumber, movements, traceId, logger) : await bulkImport(referenceNumber, movements, traceId, logger)

  if (apiResponse.failed) {
    logger.info(`GRAFANA_REPORT >> spreadsheet_submission_processed >> failed `, {
      organisationId,
      referenceNumber,
      spreadsheetRejectionReasion: 'BulkImportApiCallFailed'
    })
    await sendEmail.sendFailed({ email: decryptedEmail, name: decryptedName, referenceNumber, filename })
    logTime('apiResponse.failed')
    return
  }

  if (apiResponse.errors) {
    await handleApiResponseErrors({ logger, organisationId, referenceNumber, apiResponse, rowNumbers, workbookBytes, movements, uploadType, s3Client, s3Bucket, s3Key, decryptedEmail, decryptedName, filename, logTime })
    return
  }

  if (apiResponse.movements) {
    await handleApiResponseMovements({ logger, organisationId, referenceNumber, apiResponse, rowNumbers, workbookBytes, movements, uploadType, s3Client, s3Bucket, s3Key, decryptedEmail, decryptedName, filename, logTime, isUpdate })
    return
  }
  logTime('unhandled')
  logger.error(`ReferenceNumber: ${referenceNumber} -- Unhandled case. No errors or waste tracking ids generated for ${referenceNumber}`)
}

export const processSpreadsheetJob = async (s3Client, message) => {
  const { s3Bucket, s3Key, encryptedEmail, encryptedName, organisationId, uploadId, uploadType, hasError, referenceNumber, filename, traceId } = message
  const processJobLogger = createLogger(traceId)
  processJobLogger.info(`Message: ${JSON.stringify(message)}`)
  const decryptedEmail = decrypt(encryptedEmail, config.get('encryptionKey'))
  const decryptedName = decrypt(encryptedName, config.get('encryptionKey'))

  const emailReferenceNumber = referenceNumber ?? uploadId

  /* hasError is true if CDP has rejected or failed the spreadsheet upload, and the file won't be in the bucket */
  if (hasError) {
    processJobLogger.info(`GRAFANA_REPORT >> spreadsheet_submission_processed >> rejected >> CDP Uploader hasError`, {
      organisationId,
      uploadId,
      referenceNumber,
      spreadsheetRejectionReasion: 'cdpUploaderError'
    })
    await sendEmail.sendFailed({ email: decryptedEmail, name: decryptedName, referenceNumber: emailReferenceNumber, filename, logger: processJobLogger })
    return { logger: processJobLogger }
  }

  if (!s3Key || !s3Bucket) {
    processJobLogger.info(`Message missing s3 coords: ${JSON.stringify(message)}`)
    processJobLogger.info(`GRAFANA_REPORT >> spreadsheet_submission_processed >> rejected >> Missing S3 coords`, {
      organisationId,
      uploadId,
      referenceNumber,
      spreadsheetRejectionReasion: 'noS3KeyOrBucketError'
    })
    return { logger: processJobLogger }
  }
  try {
    await processSpreadsheet(s3Client, { s3Bucket, s3Key, organisationId, referenceNumber: emailReferenceNumber, uploadType, filename }, decryptedEmail, decryptedName, traceId, processJobLogger)
  } catch (e) {
    if (e instanceof TransientApiError) {
      throw e
    }
    processJobLogger.error(`ReferenceNumber: ${emailReferenceNumber} -- Unexpected error processing spreadsheet: ${e.stack}`)
    processJobLogger.info(`GRAFANA_REPORT >> spreadsheet_submission_processed >> rejected >> Error processing spreadsheet`, {
      organisationId,
      uploadId,
      referenceNumber,
      spreadsheetRejectionReasion: 'processingError'
    })
    await sendEmail.sendFailed({ email: decryptedEmail, name: decryptedName, referenceNumber: emailReferenceNumber, filename, logger: processJobLogger })
  }
  return { logger: processJobLogger }
}

const updatePaymentStatus = async (paymentId, govPayment, db, logger) => {
  let shouldUpdateOrg = false
  let organisation = null
  const payment = await updateWithOptimisticLock(db.collection(paymentCollection), { paymentId }, (dbPayment) => {
    if (dbPayment.status) {
      const p = updateFromGovPayEvent(dbPayment, govPayment, logger)
      shouldUpdateOrg = hasStatusChanged(dbPayment, p)
      return p
    } else {
      return null
    }
  })
  if (shouldUpdateOrg) {
    logger.info(`GRAFANA_REPORT >> service_charge_payment_outcome >> ${payment.status}`, {
      paymentStatus: payment.status,
      organisationId: payment.organisationId,
      paymentId: payment.paymentId
    })
    organisation = await updateWithOptimisticLock(db.collection(orgCollection), { organisationId: payment.organisationId }, (org) => {
      return updateOrganisationPaymentStatus(org, payment)
    })
  }
  return { payment, organisation }
}

export const processPaymentJob = (() => {
  const maxMessageAge = config.get('govPay.maxAgeOfPaymentPollingMessage')
  const isMessageTooOld = (initiatedAt) => {
    const threeDaysAgo = new Date(new Date().getTime() - maxMessageAge)
    return initiatedAt < threeDaysAgo
  }
  return async (db, message) => {
    const { paymentId, organisationId, traceId, initiatedAt } = message
    const processJobLogger = createLogger(traceId)
    processJobLogger.debug(`Looking for paymentId ${paymentId}, organisationId ${organisationId}, initiatedAt ${initiatedAt}`)
    const govPayment = await getPaymentStatus(paymentId, processJobLogger)
    const { payment } = await updatePaymentStatus(paymentId, govPayment.payload, db, processJobLogger)
    processJobLogger.debug(`Payment ${JSON.stringify(payment)}`)
    return { logger: processJobLogger, payment, skipDeleteMessage: isPending(payment) && !isMessageTooOld(initiatedAt) }
  }
})()

export const processRefundJob = (() => {
  const logger = defaultLogger
  return async (db, message) => {
    const lastFinishedAt = new Date(message.job.lastFinishedAt)
    const now = new Date(message.initiatedAt)
    logger.info(`fetching refund data between ${lastFinishedAt} and ${now}`)
    for await (const refund of getRefundsBetween(lastFinishedAt, now, logger)) {
      const govPayment = await getPaymentStatus(refund.payment_id, logger)
      await updatePaymentStatus(refund.payment_id, govPayment.payload, db, logger)
    }
    return { logger }
  }
})()

export const dispatchProcessJob = (s3Client, mongoClient) => async (message) => {
  defaultLogger.debug(`Received message ReceiptHandle: ${message.ReceiptHandle} message: ${message.Body}`)
  const m = JSON.parse(message.Body)
  if (m.refundQuery) {
    return await processRefundJob(mongoClient, m)
  }
  if (m.uploadId) {
    return await processSpreadsheetJob(s3Client, m)
  }
  if (m.paymentId) {
    return await processPaymentJob(mongoClient, m)
  }
  defaultLogger.info(`Could not dispatch ReceiptHandle: ${message.ReceiptHandle} message: ${JSON.stringify(m)}`)
  return null
}

const processMessage = async (message, sqsClient, action, QueueUrl) => {
  // We default to not deleting the message on errors - only when we're sure we should
  let shouldDelete = false
  let lg = defaultLogger
  try {
    const result = await action(message)
    lg = result?.logger || defaultLogger
    if (result?.skipDeleteMessage) {
      lg.info(`Skipping deleting message ${message.ReceiptHandle}`)
    } else {
      shouldDelete = true
    }
  } catch (err) {
    defaultLogger.error(`Error processing message: ${err.stack}`)
    /* We list here all the errors that should result in deleting the message. Errors with e.g. Mongo don't cause a delete, so that we can fix the condition and not lose a potentially important message.
    
    For API errors, if it's temporary, we can retry, the message will become visible again after VisibilityTimeout. Permanent errors, no point, delete the message and let the error handling that hopefully occurred in {action} take care of it */
    if (err instanceof PermanentApiError) {
      shouldDelete = true
    }
  }

  if (shouldDelete) {
    /* Failure of the delete will lead to the message being reprocessed, which is fine as messages must be idempotent. deleteMessage logs its own errors. */
    await deleteMessage(sqsClient, QueueUrl, message.ReceiptHandle, lg)
  }
}

export const pollQueue = async ({ sqsClient, QueueUrl, action }) => {
  const params = {
    QueueUrl,
    MaxNumberOfMessages: 1, // Process 1 messages at once
    WaitTimeSeconds: 20, // Long polling to reduce empty responses
    VisibilityTimeout: 600 // Hide message while processing
  }

  try {
    const command = new ReceiveMessageCommand(params)
    const data = await sqsClient.send(command)
    if (data.Messages && data.Messages.length > 0) {
      defaultLogger.info(`Received ${data.Messages.length} message(s)`)
      await processMessage(data.Messages[0], sqsClient, action, QueueUrl) // Assumes batch size is 1 - see MaxNumberOfMessages above
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

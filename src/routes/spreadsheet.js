import Boom from '@hapi/boom'
import joi from 'joi'
import { paths } from '../config/paths.js'
import { spreadsheetSchema } from '../domain/spreadsheet.js'
import { mergeAndValidate } from '../domain/index.js'
import { updateWithOptimisticLock } from '../repositories/index.js'
import { spreadsheetCollection, findAllSpreadsheets, findUploadIdsByFilename } from '../repositories/spreadsheet.js'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { createLogger } from '../common/helpers/logging/logger.js'
import { apiKeyAuthStrategy } from '../plugins/auth.js'
import { constructS3Client } from '../backgroundProcessor.js'
import { addVersionField, swaggerResponse } from './swagger-common.js'

const logger = createLogger()

const getHandler = async (request, h) => {
  const spreadsheets = await findAllSpreadsheets(request.db, request.params.organisationId, request.params.uploadId)
  return h.response({ spreadsheets, message: 'success' })
}

const spreadsheetResponseSchema = addVersionField(spreadsheetSchema)

export const getUploadsByFilenameResponseSchema = swaggerResponse({
  uploads: [
    joi.object({
      uploadId: joi.string().required().description('Unique upload identifier'),
      referenceNumber: joi.string().optional().description('User-facing reference number for the upload'),
      processedFileUrl: joi.string().optional().description('Pre-signed S3 URL for the processed spreadsheet'),
      hasError: joi.boolean().optional().description('True when the CDP uploader rejected the file due to errors or incompatible type'),
      errorMessage: joi.string().optional().description('Details of the rejection reason')
    })
  ]
})

const getOptions = { auth: apiKeyAuthStrategy, tags: ['api'], response: { schema: swaggerResponse({ spreadsheets: [spreadsheetResponseSchema] }), sample: 0 } }
const putOptions = { auth: apiKeyAuthStrategy, tags: ['api'], response: { schema: swaggerResponse({ spreadsheet: spreadsheetResponseSchema }), sample: 0 } }

const sendJob = async (client, QueueUrl, jobData) => {
  const params = {
    QueueUrl,
    MessageBody: JSON.stringify(jobData),
    MessageAttributes: {
      JobType: {
        DataType: 'String',
        StringValue: 'process_excel_file'
      }
    }
  }

  try {
    const command = new SendMessageCommand(params)
    const result = await client.send(command)
    logger.info(`Job sent to queue: ${result.MessageId}`)
    return result.MessageId
  } catch (err) {
    logger.error(`Error sending job: ${err}`)
    throw err
  }
}

const scheduleProcessor = async (sqsClient, queueUrl, jobData) => {
  // TODO check state of the data - maybe only do this if it's just become ready or something??
  sendJob(sqsClient, queueUrl, jobData)
  return null
}

const putHandler = async (request, h) => {
  try {
    const organisationId = request.params.organisationId
    const uploadId = request.params.uploadId
    const data = await updateWithOptimisticLock(request.db.collection(spreadsheetCollection), { uploadId, organisationId }, (dbSpreadsheet) => {
      const s = { organisationId, uploadId, ...request?.payload?.spreadsheet, updatedAtTimstamp: new Date(), traceId: request.getTraceId() }
      return mergeAndValidate(dbSpreadsheet, s, spreadsheetSchema)
    })
    // TODO check data for criteria to schedule processing
    await scheduleProcessor(request.sqsClient, request.backgroundProcessSqsQueueUrl, data)
    return h.response({ message: 'success', spreadsheet: data })
  } catch (e) {
    logger.error(`Error storing spreadsheet info ${e}`)
    return h.response({
      message: 'error',
      errors: e.isJoi ? e.details : [`${e}`]
    })
  }
}

const getUploadsByFilenameHandler = async (request, h) => {
  const { organisationId } = request.params
  const { filename } = request.query
  const uploads = await findUploadIdsByFilename(request.db, organisationId, filename)
  if (uploads.length === 0) {
    throw Boom.notFound('No spreadsheets found for the given filename')
  }

  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
  const s3Client = constructS3Client()
  const enrichedUploads = await Promise.all(
    uploads.map(async ({ uploadId, s3Bucket, s3Key, hasError, errorMessage, referenceNumber }) => {
      const upload = { uploadId }
      if (referenceNumber) {
        upload.referenceNumber = referenceNumber
      }
      if (hasError) {
        upload.hasError = true
      }
      if (errorMessage) {
        upload.errorMessage = errorMessage
      }
      if (!s3Bucket || !s3Key) {
        return upload
      }
      try {
        const url = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: s3Bucket, Key: `${s3Key}-processed` }), { expiresIn: 3600 })
        upload.processedFileUrl = url
        return upload
      } catch (err) {
        logger.warn(`Failed to generate presigned URL for ${s3Key}-processed: ${err.message}`)
        return upload
      }
    })
  )

  return h.response({ message: 'success', uploads: enrichedUploads })
}

const getUploadsByFilenameOptions = {
  auth: apiKeyAuthStrategy,
  tags: ['api', 'test'],
  description: 'Get uploads by filename',
  notes: [
    'Returns uploads matching the given filename for an organisation.',
    'Includes hasError/errorMessage when the CDP uploader rejected a file due to errors or incompatible type.'
  ],
  validate: {
    query: joi.object({ filename: joi.string().required().description('The original filename of the uploaded spreadsheet') }),
    params: joi.object({ organisationId: joi.string().required().description('The organisation identifier') })
  },
  response: { schema: getUploadsByFilenameResponseSchema, sample: 0 }
}

export const testSpreadsheetRoutes = [
  {
    method: 'GET',
    path: paths.getUploadsByFilename,
    options: getUploadsByFilenameOptions,
    handler: getUploadsByFilenameHandler
  }
]

export const spreadsheet = [
  {
    method: 'GET',
    path: paths.getSpreadsheets,
    options: getOptions,
    handler: getHandler
  },
  {
    method: 'GET',
    path: paths.getOneSpreadsheet,
    options: getOptions,
    handler: getHandler
  },
  {
    method: 'PUT',
    path: paths.putSpreadsheet,
    options: putOptions,
    handler: putHandler
  }
]

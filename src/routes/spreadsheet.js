import { paths } from '../config/paths.js'
import { spreadsheetSchema } from '../domain/spreadsheet.js'
import { mergeAndValidate } from '../domain/index.js'
import { updateWithOptimisticLock } from '../repositories/index.js'
import { spreadsheetCollection, findAllSpreadsheets, findUploadIdsByFilename } from '../repositories/spreadsheet.js'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { createLogger } from '../common/helpers/logging/logger.js'
import Boom from '@hapi/boom'
import joi from 'joi'
import { apiKeyAuthStrategy } from '../plugins/auth.js'
import { getSpreadsheetsResponseSchema, getUploadsByFilenameResponseSchema, putSpreadsheetResponseSchema } from './schemas/spreadsheet.js'

const logger = createLogger()

const getHandler = async (request, h) => {
  const spreadsheets = await findAllSpreadsheets(request.db, request.params.organisationId, request.params.uploadId)
  return h.response({ spreadsheets, message: 'success' })
}

const getOptions = { auth: apiKeyAuthStrategy, tags: ['api'], response: { schema: getSpreadsheetsResponseSchema, sample: 0 } }
const putOptions = { auth: apiKeyAuthStrategy, tags: ['api'], response: { schema: putSpreadsheetResponseSchema, sample: 0 } }

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
    logger.info(`params: ${params}`)
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
      const s = { organisationId, uploadId, ...request?.payload?.spreadsheet, updatedAtTimstamp: new Date() }
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
  return h.response({ message: 'success', uploads })
}

const getUploadsByFilenameOptions = {
  auth: apiKeyAuthStrategy,
  tags: ['api', 'test'],
  validate: {
    query: joi.object({ filename: joi.string().required() })
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

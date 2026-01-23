import { paths } from '../config/paths.js'
import { spreadsheetSchema } from '../domain/spreadsheet.js'
import { mergeAndValidate } from '../domain/index.js'
import { updateWithOptimisticLock } from '../repositories/index.js'
import {
  spreadsheetCollection,
  findAllSpreadsheets
} from '../repositories/spreadsheet.js'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { config } from '../config.js'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

const getHandler = async (request, h) => {
  const spreadsheets = await findAllSpreadsheets(
    request.db,
    request.params.organisationId,
    request.params.uploadId
  )
  return h.response({ spreadsheets, message: 'success' })
}

const options = { auth: 'api-key-auth' }

const constructSqsClient = () => {
  try {
    return new SQSClient({
      region: config.get('aws.region'),
      endpoint: config.get('aws.sqsEndpoint')
    })
  } catch (e) {
    logger.error(`Error could not initialise SQS Client: ${e}`)
    return null
  }
}

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

const scheduleProcessor = async (sqsClient, queueUrl, spreadsheet) => {
  // TODO check state of the data - maybe only do this if it's just become ready or something??
  sendJob(sqsClient, queueUrl, spreadsheet)
  return null
}

const putHandler = (sqsClient) => {
  const queueUrl = config.get('aws.backgroundProcessQueue')
  return async (request, h) => {
    try {
      const organisationId = request.params.organisationId
      const uploadId = request.params.uploadId
      const s = await updateWithOptimisticLock(
        request.db.collection(spreadsheetCollection),
        { uploadId, organisationId },
        (dbSpreadsheet) => {
          return mergeAndValidate(
            dbSpreadsheet,
            { organisationId, uploadId, ...request?.payload?.spreadsheet },
            spreadsheetSchema
          )
        }
      )
      // TODO don't do all the work in the callback response
      await scheduleProcessor(sqsClient, queueUrl, s)
      return h.response({ message: 'success', spreadsheet: s })
    } catch (e) {
      logger.error(`Error storing spreadsheet info ${e}`)
      return h.response({
        message: 'error',
        errors: e.isJoi ? e.details : [`${e}`]
      })
    }
  }
}

export const spreadsheet = [
  {
    method: 'GET',
    path: paths.getSpreadsheets,
    options,
    handler: getHandler
  },
  {
    method: 'GET',
    path: paths.getOneSpreadsheet,
    options,
    handler: getHandler
  },
  {
    method: 'PUT',
    path: paths.putSpreadsheet,
    options,
    handler: putHandler(constructSqsClient())
  }
]

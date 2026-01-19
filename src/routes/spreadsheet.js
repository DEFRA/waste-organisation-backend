import { paths } from '../config/paths.js'
import { spreadsheetSchema } from '../domain/spreadsheet.js'
import { mergeAndValidate } from '../domain/index.js'
import { updateWithOptimisticLock } from '../repositories/index.js'
import {
  spreadsheetCollection,
  findAllSpreadsheets
} from '../repositories/spreadsheet.js'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
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

const constructS3Client = () => {
  return new S3Client({
    region: config.get('aws.region'),
    endpoint: config.get('aws.s3Endpoint'),
    forcePathStyle: config.get('aws.forcePathStyle')
  })
}

const maybeFetchAndProcessSpreadsheet = async (s3Client, spreadsheet) => {
  console.log('spreadsheet: ', spreadsheet)
  const request = new GetObjectCommand({
    Bucket: spreadsheet.s3Bucket,
    Key: spreadsheet.s3Key,
    Range: 'bytes=0-9',
    ChecksumMode: config.get('aws.checksumMode')
  })
  const response = await s3Client.send(request)
  const bytes = await response.Body.transformToByteArray()
  logger.info('Fetching bytes: ', bytes)
  return null
}

const putHandler = (s3Client) => {
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
      await maybeFetchAndProcessSpreadsheet(s3Client, s)
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
    handler: putHandler(constructS3Client())
  }
]

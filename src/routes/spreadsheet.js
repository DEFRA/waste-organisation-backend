import { paths } from '../config/paths.js'
import { spreadsheetSchema } from '../domain/spreadsheet.js'
import { mergeAndValidate } from '../domain/index.js'
import { updateWithOptimisticLock } from '../repositories/index.js'
import {
  spreadsheetCollection,
  findAllSpreadsheets
} from '../repositories/spreadsheet.js'

const getHandler = async (request, h) => {
  const spreadsheets = await findAllSpreadsheets(
    request.db,
    request.params.organisationId,
    request.params.uploadId
  )
  return h.response({ spreadsheets, message: 'success' })
}

export const spreadsheet = [
  {
    method: 'GET',
    path: paths.getSpreadsheets,
    options: { auth: 'api-key-auth' },
    handler: getHandler
  },
  {
    method: 'GET',
    path: paths.getOneSpreadsheet,
    options: { auth: 'api-key-auth' },
    handler: getHandler
  },
  {
    method: 'PUT',
    path: paths.putSpreadsheet,
    options: { auth: 'api-key-auth' },
    handler: async (request, h) => {
      try {
        const organisationId = request.params.organisationId
        const uploadId = request.params.uploadId
        const spreadsheet = await updateWithOptimisticLock(
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
        return h.response({ message: 'success', spreadsheet })
      } catch (e) {
        return h.response({
          message: 'error',
          errors: e.isJoi ? e.details : [`${e}`]
        })
      }
    }
  }
]

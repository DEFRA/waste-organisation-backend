import joi from 'joi'
import { spreadsheetSchema } from '../../domain/spreadsheet.js'

const messageSchema = joi.string().valid('success', 'error').required()

const spreadsheetResponseSchema = spreadsheetSchema.append({
  version: joi.number().integer()
})

export const getSpreadsheetsResponseSchema = joi.object({
  message: messageSchema,
  spreadsheets: joi.array().items(spreadsheetResponseSchema).required()
})

export const getUploadsByFilenameResponseSchema = joi.object({
  message: messageSchema,
  uploads: joi
    .array()
    .items(
      joi.object({
        uploadId: joi.string().required().description('Unique upload identifier'),
        referenceNumber: joi.string().optional().description('User-facing reference number for the upload'),
        processedFileUrl: joi.string().optional().description('Pre-signed S3 URL for the processed spreadsheet'),
        hasError: joi.boolean().optional().description('True when the CDP uploader rejected the file due to errors or incompatible type'),
        errorMessage: joi.string().optional().description('Details of the rejection reason')
      })
    )
    .required()
})

export const putSpreadsheetResponseSchema = joi
  .object({
    message: messageSchema,
    spreadsheet: spreadsheetResponseSchema,
    errors: joi.array().items(joi.alternatives().try(joi.string(), joi.object()))
  })
  .or('spreadsheet', 'errors')

import joi from 'joi'
import { spreadsheetSchema } from '../../domain/spreadsheet.js'

const messageSchema = joi.string().valid('success', 'error').required()

export const getSpreadsheetsResponseSchema = joi.object({
  message: messageSchema,
  spreadsheets: joi.array().items(spreadsheetSchema).required()
})

export const putSpreadsheetResponseSchema = joi
  .object({
    message: messageSchema,
    spreadsheet: spreadsheetSchema,
    errors: joi.array().items(joi.alternatives().try(joi.string(), joi.object()))
  })
  .or('spreadsheet', 'errors')

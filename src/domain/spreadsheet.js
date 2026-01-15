import joi from 'joi'

export const spreadsheetSchema = joi.object({
  organisationId: joi.string().required(),
  uploadId: joi.string(),
  s3bucket: joi.string(),
  s3object: joi.string(),
  statusUrl: joi.string().required()
})

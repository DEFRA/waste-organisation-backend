import joi from 'joi'

export const spreadsheetSchema = joi.object({
  checksumSha256: joi.string(),
  contentLength: joi.number(),
  contentType: joi.string(),
  detectedContentType: joi.string(),
  fileId: joi.string(),
  filename: joi.string(),
  organisationId: joi.string().required(),
  s3Bucket: joi.string(),
  s3Key: joi.string(),
  // statusUrl: joi.string().required(),
  uploadId: joi.string(),
  uploadStatus: joi.string(),
  encryptedEmail: joi.array().items(joi.string())
})

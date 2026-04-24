import joi from 'joi'
// import * as common from './index.js'

export const paymentSchema = joi.object({
  paymentId: joi.string().required(),
  organisationId: joi.string().required(),
  status: joi.string()
})

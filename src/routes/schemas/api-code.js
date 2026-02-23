import joi from 'joi'
import { apiCodeSchema } from '../../domain/organisation.js'

export { apiCodeSchema as apiCodeResponseSchema } from '../../domain/organisation.js'

export const lookupOrgResponseSchema = joi.object({
  defraOrganisationId: joi.string().required()
})

export const listApiCodesResponseSchema = joi.object({
  apiCodes: joi.array().items(apiCodeSchema).required()
})

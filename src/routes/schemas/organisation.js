import joi from 'joi'

const messageSchema = joi.string().valid('success', 'error').required()

const organisationResponseSchema = joi.object({
  organisationId: joi.string().required(),
  users: joi.array().items(joi.string()),
  name: joi.string(),
  isWasteReceiver: joi.boolean()
})

export const getOrganisationsResponseSchema = joi.object({
  message: messageSchema,
  organisations: joi.array().items(organisationResponseSchema).required()
})

export const putOrganisationResponseSchema = joi
  .object({
    message: messageSchema,
    organisation: organisationResponseSchema,
    errors: joi.array().items(joi.alternatives().try(joi.string(), joi.object()))
  })
  .or('organisation', 'errors')

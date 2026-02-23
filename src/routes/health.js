import joi from 'joi'

const healthResponseSchema = joi.object({
  message: joi.string().required()
})

const health = {
  method: 'GET',
  path: '/health',
  options: {
    auth: false,
    tags: ['api'],
    response: { schema: healthResponseSchema, sample: 0 }
  },
  handler: (_request, h) => h.response({ message: 'success' })
}

export { health }

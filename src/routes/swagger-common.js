import joi from 'joi'

export const messageSchema = joi.string().valid('success', 'error').required()

export const addVersionField = (schema) =>
  schema.append({
    version: joi.number().integer()
  })

export const errorSchema = joi.array().items(joi.alternatives().try(joi.string(), joi.object()))

export const response = (response) => {
  const r = Object.keys(response).reduce((s, k) => {
    if (Array.isArray(response[k])) {
      s[k] = joi.array().items(addVersionField(response[k][0]))
    } else {
      s[k] = addVersionField(response[k])
    }
    return s
  }, {})
  const fs = Object.keys(response).concat(['errors'])
  return joi
    .object(r)
    .append({ message: messageSchema })
    .append({ errors: errorSchema })
    .or(...fs)
}

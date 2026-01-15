import joi from 'joi'

export const mergeParams = (dbEntity, requestEntity) => {
  if (dbEntity) {
    return {
      ...dbEntity,
      ...requestEntity
    }
  } else {
    return requestEntity
  }
}

export const mergeAndValidate = (dbEntity, requestEntity, entitySchema) => {
  const entity = mergeParams(dbEntity, requestEntity)
  return joi.attempt(entity, entitySchema, 'Validation Error', {
    abortEarly: false,
    stripUnknown: true
  })
}

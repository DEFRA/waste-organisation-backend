import joi from 'joi'
import * as common from './index.js'

export const scheduledTaskSchema = joi.object({
  name: joi.string().required(),
  runCount: joi.number().optional(),
  lastFinishedAt: joi.date()
})

export const mergeAndValidate = (dbTask, requestTask) => {
  return common.mergeAndValidate(dbTask, requestTask, scheduledTaskSchema)
}

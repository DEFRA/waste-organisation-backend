import { constructSqsClient, sendSqsMessage } from './plugins/sqs.js'
import { createLogger } from './common/helpers/logging/logger.js'
import { config } from './config.js'
import { MongoClient } from 'mongodb'

import cron from 'node-cron'
import { updateWithOptimisticLock } from './repositories/index.js'
import { findScheduledTaskByName, scheduledTasksCollection } from './repositories/scheduleTasks.js'
import { mergeAndValidate } from './domain/scheduledTasks.js'

const claimLock = async (db, lockName, logger) => {
  try {
    await db.collection('mongo-locks').insertOne({ _id: lockName, timestamp: new Date() })
    logger.info(`Creating lock - ${lockName}`)
    return true
  } catch (error) {
    logger.error(`Unable to create lock - ${lockName}`, error)
    return false
  }
}
export const constructMongoClient = async () => {
  const options = config.get('mongo')
  const client = await MongoClient.connect(options.mongoUrl, {
    ...options.mongoOptions
  })
  return client.db(options.databaseName)
}

export const scheduleBackgroundProcess =
  ({ queueUrl, logger, sqsClient }) =>
  async (job) => {
    logger.info(`Starting scheduled job - ${job.name} - ${JSON.stringify(job)}`)
    const message = {
      refundQuery: 'initiate polling',
      initiatedAt: new Date(),
      job
    }
    await sendSqsMessage(message, 'refund_polling', queueUrl, logger, sqsClient)
  }

export const scheduledJobs = {
  REFUND_POLLING: {
    enabled: true,
    name: 'Poll for refunds that have been initiated',
    schedule: config.get('govPay.refundPollingSchedule'),
    func: scheduleBackgroundProcess
  }
}

const constructSchedular = (db, logger, jobName, jobSchedule, func) => {
  const time = () => new Date().toTimeString().split(' ')[0]
  const task = cron.schedule(
    jobSchedule,
    async () => {
      const lock = await claimLock(db, jobName, logger)
      if (!lock) {
        return
      }
      logger.info(`Job <${jobName}> starting at ${time()}`)
      const previousTask = await findScheduledTaskByName(db, jobName)
      if (previousTask) {
        await func(previousTask)
      }

      await updateWithOptimisticLock(db.collection(scheduledTasksCollection), { name: jobName }, (dbTask) => {
        const newData = mergeAndValidate(dbTask, {
          name: jobName,
          runCount: dbTask?.runCount ? dbTask.runCount + 1 : 1,
          lastFinishedAt: new Date()
        })
        return newData
      })
      logger.info(`Job <${jobName}> succeeded at ${time()}`)
    },
    {
      name: jobName
    }
  )

  task.on('execution:failed', (ctx) => {
    logger.error(ctx.execution?.error, `Job <${jobName}> failed at ${time()}`)
  })

  return task
}

const createTasks = async (jobs, logger, db, sqsClient, queueUrl) => {
  const tasks = []
  for (const [key, job] of Object.entries(jobs)) {
    logger.debug(`node-cron starting ${key} - ${job.schedule}`)
    tasks.push(constructSchedular(db, logger, job.name, job.schedule, job.func({ sqsClient, queueUrl, logger })))
  }
  return tasks
}

export const startTasks = async (jobs) => {
  const logger = createLogger()
  try {
    const queueUrl = config.get('aws.backgroundProcessQueue')
    const sqsClient = constructSqsClient({
      region: config.get('aws.region'),
      endpoint: config.get('aws.sqsEndpoint')
    })
    const db = await constructMongoClient()
    const tasks = await createTasks(jobs ?? scheduledJobs, logger, db, sqsClient, queueUrl)
    const stopScheduling = async () => {
      if (!tasks || tasks.length < 1) {
        return null
      }

      for (const task of tasks) {
        await task.stop()
        logger.info('Cron stopped')
      }

      return null
    }
    return { stopScheduling, tasks }
  } catch (e) {
    logger.error(`Error defining scheduled jobs ${e} - ${e.stack}`)
    return { error: e }
  }
}

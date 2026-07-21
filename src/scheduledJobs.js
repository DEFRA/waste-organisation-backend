import { constructSqsClient, sendSqsMessage } from './plugins/sqs.js'
import { createLogger } from './common/helpers/logging/logger.js'
import { config } from './config.js'
import { MongoClient } from 'mongodb'

import cron from 'node-cron'
import { updateWithOptimisticLock } from './repositories/index.js'
import { findScheduledTaskByName, scheduledTasksCollection } from './repositories/scheduledTasks.js'
import { mergeAndValidate } from './domain/scheduledTasks.js'
import { acquireLock, lockManager } from './plugins/mongo-lock.js'

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

const constructScheduler = (db, logger, locker, jobName, jobSchedule, func) => {
  const time = () => new Date().toTimeString().split(' ')[0]
  const task = cron.schedule(
    jobSchedule,
    async () => {
      const lock = await acquireLock(locker, jobName, logger)
      if (!lock) {
        logger.info(`Job <${jobName}> already running - skipping at ${time()}`)
        return
      }
      try {
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
      } finally {
        await lock.free()
      }
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

const createTasks = async (jobs, logger, db, sqsClient, queueUrl, locker) => {
  const tasks = []
  for (const [key, job] of Object.entries(jobs)) {
    logger.debug(`node-cron starting ${key} - ${job.schedule}`)
    tasks.push(constructScheduler(db, logger, locker, job.name, job.schedule, job.func({ sqsClient, queueUrl, logger })))
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
    const locker = await lockManager(db)
    const tasks = await createTasks(jobs ?? scheduledJobs, logger, db, sqsClient, queueUrl, locker)
    const stopScheduling = async () => {
      if (tasks && tasks.length > 0) {
        for (const task of tasks) {
          await task.stop()
          logger.info('Cron stopped')
        }
      }

      return null
    }
    return { stopScheduling, tasks }
  } catch (e) {
    logger.error(`Error defining scheduled jobs ${e} - ${e.stack}`)
    return { error: e }
  }
}

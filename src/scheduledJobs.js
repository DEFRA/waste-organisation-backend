import { Pulse } from '@pulsecron/pulse'
import { constructSqsClient, sendSqsMessage } from './plugins/sqs.js'
import { createLogger } from './common/helpers/logging/logger.js'
import { config } from './config.js'

export const scheduledJobs = {
  REFUND_POLLING: {
    enabled: true,
    name: 'Poll for refunds that have been initiated',
    schedule: config.get('govPay.refundPollingSchedule')
  }
}

const buildMongoUri = () => {
  const mongoUri = config.get('mongo.mongoUrl')
  const dbName = config.get('mongo.databaseName')

  if (mongoUri.includes('/admin')) {
    const replacedUri = mongoUri.replace('/admin', `/${dbName}`)
    return replacedUri
  }

  return `${mongoUri}${dbName}`
}

const constructPulse = (mongoAddress, logger) => {
  const time = () => new Date().toTimeString().split(' ')[0]
  const pulse = new Pulse(
    {
      db: {
        address: mongoAddress,
        collection: 'scheduledTasks'
      },
      defaultConcurrency: 2,
      maxConcurrency: 2,
      processEvery: '300 seconds',
      resumeOnRestart: true
    },
    (error, collection) => {
      if (error) {
        logger.error(`Pulse Mongo connection error: ${error}`)
      } else {
        logger.info(`Pulse connected to collection: ${collection.collectionName}`)
      }
    }
  )
  pulse.on('start', (job) => {
    logger.info(`Job <${job.attrs.name}> starting at ${time()}`)
  })
  pulse.on('success', (job) => {
    logger.info(`Job <${job.attrs.name}> succeeded at ${time()}`)
  })
  pulse.on('fail', (error, job) => {
    logger.error(error, `Job <${job.attrs.name}> failed at ${time()}`)
  })
  return pulse
}

const startJobs = (jobs, pulse, logger, sqsClient, queueUrl) => {
  logger.info('Starting Pulse scheduling...')
  const lockLifetime = 120000 // 2 minutes in ms
  const backoffDelay = 30000 // 30 seconds in ms
  const defaultJobSettings = {
    lockLifetime,
    priority: 'high',
    attempts: 4,
    backoff: { type: 'exponential', delay: backoffDelay },
    shouldSaveResult: false
  }
  for (const j in jobs) {
    pulse.define(
      jobs[j].name,
      async (job) => {
        logger.info(`Starting scheduled job - ${jobs[j].name} - ${job}`)
        const message = {
          refundQuery: 'initiate polling',
          initiatedAt: new Date(),
          job
        }
        await sendSqsMessage(message, 'refund_polling', queueUrl, logger, sqsClient)
      },
      defaultJobSettings
    )
  }
  logger.info(`Pulse started and ${Object.keys(jobs)} jobs scheduled`)
}

export const startTasks = () => {
  const logger = createLogger()
  const queueUrl = config.get('aws.backgroundProcessQueue')
  const sqsClient = constructSqsClient({
    region: config.get('aws.region'),
    endpoint: config.get('aws.sqsEndpoint')
  })
  const pulse = constructPulse(buildMongoUri())
  startJobs(scheduledJobs, pulse, logger, sqsClient, queueUrl)
  const stopPulseScheduling = async () => {
    await pulse.stop()
    logger.info('Pulse stopped')
  }
  return { stopPulseScheduling }
}

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

const constructPulse = (mongoAddress, logger) => {
  const time = () => new Date().toTimeString().split(' ')[0]
  logger.info('Connecting to Pulse ... ' + mongoAddress)
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

const startJobs = async (jobs, pulse, logger, sqsClient, queueUrl) => {
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
    logger.debug(`Pulse starting ${j} - ${jobs[j].schedule}`)
    await pulse.define(
      jobs[j].name,
      async (job) => {
        logger.info(`Starting scheduled job - ${jobs[j].name} - ${JSON.stringify(job)}`)
        const message = {
          refundQuery: 'initiate polling',
          initiatedAt: new Date(),
          job
        }
        await sendSqsMessage(message, 'refund_polling', queueUrl, logger, sqsClient)
      },
      defaultJobSettings
    )
    await pulse.every(jobs[j].schedule, jobs[j].name)
  }
  logger.info(`Pulse started and ${Object.keys(jobs)} jobs scheduled`)
}

export const startTasks = async () => {
  const logger = createLogger()
  try {
    const queueUrl = config.get('aws.backgroundProcessQueue')
    const mongoUri = config.get('mongo.mongoUrl').replace(/(.*)\//, '$1/' + config.get('mongo.databaseName'))
    const sqsClient = constructSqsClient({
      region: config.get('aws.region'),
      endpoint: config.get('aws.sqsEndpoint')
    })
    const pulse = constructPulse(mongoUri, logger)
    await pulse.start()
    await startJobs(scheduledJobs, pulse, logger, sqsClient, queueUrl)
    const stopPulseScheduling = async () => {
      await pulse.stop()
      logger.info('Pulse stopped')
    }
    return { stopPulseScheduling }
  } catch (e) {
    logger.error(`Error defining pulse jobs ${e} - ${e.stack}`)
    return {}
  }
}

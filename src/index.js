import process from 'node:process'

import { createLogger } from './common/helpers/logging/logger.js'
import { createServer, startServer } from './api-server.js'
import { startWorker } from './backgroundProcessor.js'
import { startTasks } from './scheduledJobs.js'
import { config } from './config.js'

process.env.TZ = config.get('bulkUpload.spreadsheetTimezone')

startWorker()

startTasks()

await startServer(await createServer())

process.on('unhandledRejection', (error) => {
  const logger = createLogger()
  logger.info('Unhandled rejection')
  logger.error(error)
  process.exitCode = 1
})

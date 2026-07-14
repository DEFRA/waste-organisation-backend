import process from 'node:process'

import { createLogger } from './common/helpers/logging/logger.js'
import { createServer, startServer } from './api-server.js'
import { startWorker } from './backgroundProcessor.js'
import { startTasks } from './scheduledJobs.js'
import { config } from './config.js'

process.env.TZ = config.get('bulkUpload.spreadsheetTimezone')

await startServer(await createServer())

startWorker()
const { stopScheduling } = await startTasks()

process.on('unhandledRejection', (error) => {
  const logger = createLogger()
  logger.info('Unhandled rejection')
  logger.error(error)
  process.exitCode = 1
})

process.on('exit', async () => {
  await stopScheduling()
})

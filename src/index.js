import process from 'node:process'

import { createLogger } from './common/helpers/logging/logger.js'
import { createServer, startServer } from './api-server.js'

await startServer(await createServer())

process.on('unhandledRejection', (error) => {
  const logger = createLogger()
  logger.info('Unhandled rejection')
  logger.error(error)
  process.exitCode = 1
})

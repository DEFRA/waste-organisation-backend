import process from 'node:process'
import { createLogger } from './common/helpers/logging/logger.js'
import { createServer, startServer } from './api-server.js'
import {
  listenForDefraIdMessages,
  messageHandler
} from './service-bus-listener.js'

await startServer(await createServer())

process.on('unhandledRejection', (error) => {
  const logger = createLogger()
  logger.info('Unhandled rejection')
  logger.error(error)
  process.exitCode = 1
})

export const defraIdListener = listenForDefraIdMessages(messageHandler)

process.on('SIGTERM', defraIdListener.close)
process.on('SIGINT', defraIdListener.close)

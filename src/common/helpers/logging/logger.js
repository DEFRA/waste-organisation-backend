import { pino } from 'pino'
import { loggerOptions } from './logger-options.js'

function createLogger(traceId = null) {
  return pino(loggerOptions(traceId))
}
export { createLogger }

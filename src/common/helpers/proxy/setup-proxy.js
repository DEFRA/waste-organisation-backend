import http from 'node:http'
import https from 'node:https'
import Wreck from '@hapi/wreck'
import { createLogger } from '../logging/logger.js'
import { config } from '../../../config.js'

const logger = createLogger()

export const setupProxy = () => {
  if (config.get('httpProxy')) {
    logger.info('Routing outbound requests via proxy')
    // Required for Wreck
    Wreck.agents.http = http.globalAgent
    Wreck.agents.https = https.globalAgent
  }
  return Wreck
}

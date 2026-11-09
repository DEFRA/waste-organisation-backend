import process from 'node:process'
import Hapi from '@hapi/hapi'
import { secureContext } from '@defra/hapi-secure-context'
import { config } from './config.js'
import { mongoDb } from './plugins/mongodb.js'
import { requestLogger } from './common/helpers/logging/request-logger.js'
import { createLogger } from './common/helpers/logging/logger.js'

/*
 * Standalone entry point for running DB migrations without a full server boot, likely run through npm.
 * The migrations are run as a side effect of initialising the mongodb plugin.
 * secureContext patches tls.createSecureContext so the DocumentDB TLS handshake
 * trusts the CDP CA bundle; mongoDb.register() runs the migrate-mongo migrations
 * (lock-guarded) as its init side effect. No routes, auth, worker or scheduler.
 */
const logger = createLogger()

try {
  const server = Hapi.server({})
  /* requestLogger (hapi-pino) must be first, it provides server.logger, which
  secureContext and mongoDb both use during their own register() */
  await server.register([requestLogger, secureContext, { plugin: mongoDb, options: config.get('mongo') }])
  logger.info('Starting DB migrations')
  await server.initialize() // fires db scripts
  await server.stop({ timeout: 0 })
  logger.info('DB migrations complete')
  process.exit(0)
} catch (e) {
  logger.error(e, 'DB migrations failed')
  process.exit(1)
}

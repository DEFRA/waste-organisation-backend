import Hapi from '@hapi/hapi'

import { secureContext } from '@defra/hapi-secure-context'

import { config } from './config.js'
import { router } from './plugins/router.js'
import { requestLogger } from './common/helpers/logging/request-logger.js'
import { mongoDb } from './plugins/mongodb.js'
import { failAction } from './common/helpers/fail-action.js'
import { pulse } from './common/helpers/pulse.js'
import { requestTracing } from './common/helpers/request-tracing.js'
import { setupProxy } from './common/helpers/proxy/setup-proxy.js'

// prettier-ignore
export const plugins = {
  logger: requestLogger,   // requestLogger  - automatically logs incoming requests
  tracing: requestTracing, // requestTracing - trace header logging and propagation
  secureContext,           // secureContext  - loads CA certificates from environment config
  pulse,                   // pulse          - provides shutdown handlers
  mongoDb: {               // mongoDb        - sets up mongo connection pool and attaches to `server` and `request` objects
    plugin: mongoDb,
    options: config.get('mongo')
  },
  router                   // router         - routes used in the app
}

export async function createServer(pluginOverrides) {
  setupProxy()
  const server = Hapi.server({
    host: config.get('host'),
    port: config.get('port'),
    routes: {
      validate: {
        options: {
          abortEarly: false
        },
        failAction
      },
      security: {
        hsts: {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: false
        },
        xss: 'enabled',
        noSniff: true,
        xframe: true
      }
    },
    router: {
      stripTrailingSlash: true
    }
  })

  // Hapi Plugins:

  await server.register(Object.values({ ...plugins, ...pluginOverrides }))
  return server
}

export async function startServer(server) {
  await server.start()

  server.logger.info('Server started successfully')
  server.logger.info(
    `Access your backend on http://localhost:${config.get('port')}`
  )

  return server
}

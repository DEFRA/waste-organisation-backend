import { config } from '../config.js'
import boom from '@hapi/boom'

const authScheme = (_server, _options) => ({
  authenticate: async (request, h) => {
    const apiKey = request?.headers['x-auth-token']
    if (config?.get('auth.clients')?.includes(apiKey)) {
      return h.authenticated({ credentials: { valid: true } })
    } else {
      throw boom.forbidden('no valid auth token')
    }
  }
})

export const authentication = {
  plugin: {
    name: 'auth',
    version: '1.0.0',
    register: async function (server, _options) {
      server.auth.scheme('api-key-authentication', authScheme)
      server.auth.strategy('api-key-auth', 'api-key-authentication', {})
    }
  }
}

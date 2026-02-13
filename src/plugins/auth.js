import { config } from '../config.js'
import boom from '@hapi/boom'

const parseApiKey = (apiKey) => {
  if (apiKey.startsWith('Basic ')) {
    const parts = Buffer.from(apiKey.split(' ')[1], 'base64').toString('utf8').split(':')
    return parts[parts.length - 1]
  } else {
    return apiKey
  }
}

const authScheme = (_server, _options) => ({
  authenticate: async (request, h) => {
    const apiKey = parseApiKey(request?.headers['x-auth-token'] || request?.headers['authorization'])
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

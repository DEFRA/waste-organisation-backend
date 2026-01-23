import * as mockMongo from 'vitest-mongodb'
import { createServer, plugins } from '../../api-server.js'
import { updateClientAuthKeys } from '../../config.js'

export const WASTE_CLIENT_AUTH_TEST_TOKEN = 'mytesttoken'

const mockSqs = () => ({
  plugin: {
    name: 'sqsPlugin',
    version: '1.0.0',
    register: async (server, options) => {
      server.decorate('request', 'sqsClient', {
        send: async () => ({ MessageId: 'dummy' })
      })
      server.decorate(
        'request',
        'backgroundProcessSqsQueueUrl',
        'http://example.com/sqs/queue/url'
      )
    }
  }
})

export const initialiseServer = async () => {
  process.env.WASTE_CLIENT_AUTH_TEST_TOKEN = WASTE_CLIENT_AUTH_TEST_TOKEN
  process.env.WASTE_CLIENT_AUTH_TEST_1 = 'my test token 1'
  process.env.WASTE_CLIENT_AUTH_TEST_2 = 'my test token 2'
  updateClientAuthKeys()
  mockSqs()
  await mockMongo.setup()
  const mongoDb = plugins.mongoDb
  if (globalThis?.__MONGO_URI__) {
    mongoDb.options.mongoUrl = globalThis.__MONGO_URI__
  }
  const server = await createServer({
    mongoDb,
    sqsPlugin: mockSqs()
  })
  await server.initialize()
  return server
}

export const stopServer = async (server) => {
  await server.stop({ timeout: 0 })
  await mockMongo.teardown()
}

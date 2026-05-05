import * as mockMongo from 'vitest-mongodb'

export const WASTE_CLIENT_AUTH_TEST_TOKEN = 'mytesttoken'

const mockSqs = () => ({
  plugin: {
    name: 'sqsPlugin',
    version: '1.0.0',
    register: async (server) => {
      server.decorate('request', 'sqsClient', {
        send: async () => ({ MessageId: 'dummy' })
      })
      server.decorate('request', 'backgroundProcessSqsQueueUrl', 'http://example.com/sqs/queue/url')
    }
  }
})

export const initialiseServer = async () => {
  const { createServer, plugins } = await import('../../api-server.js')
  const { updateClientAuthKeys } = await import('../../config.js')

  process.env.WASTE_CLIENT_AUTH_TEST_TOKEN = WASTE_CLIENT_AUTH_TEST_TOKEN
  process.env.WASTE_CLIENT_AUTH_TEST_1 = 'my test token 1'
  process.env.WASTE_CLIENT_AUTH_TEST_2 = '4d5d48cb-456a-470a-8814-eae2758be90d'
  updateClientAuthKeys()
  mockSqs()
  await mockMongo.setup()
  const mongoDb = plugins.mongoDb
  if (globalThis?.__MONGO_URI__) {
    mongoDb.options.mongoUrl = globalThis.__MONGO_URI__
  }
  const sqsPlugin = mockSqs()
  const server = await createServer({ mongoDb, sqsPlugin })
  await server.initialize()
  server.testPlugins = plugins
  server.testPlugins.mongoDb = mongoDb
  server.testPlugins.sqsPlugin = sqsPlugin
  return server
}

export const stopServer = async (server) => {
  await server.stop({ timeout: 0 })
  await mockMongo.teardown()
}

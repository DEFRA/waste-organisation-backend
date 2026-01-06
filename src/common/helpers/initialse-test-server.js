import * as mockMongo from 'vitest-mongodb'
import { createServer, plugins } from '../../api-server.js'
import { updateClientAuthKeys, config } from '../../config.js'

export const WASTE_CLIENT_AUTH_TEST_TOKEN = 'mytesttoken'

export const initInMemMongo = async () => {
  await mockMongo.setup({
    type: 'replSet',
    serverOptions: { replSet: { count: 4 } }
  })
  const mongoDb = plugins.mongoDb
  if (globalThis?.__MONGO_URI__) {
    mongoDb.options.mongoUrl = globalThis.__MONGO_URI__
    config.set('mongo.options', mongoDb.options)
  }
  return mongoDb
}

export const stopInMemMongo = async () => {
  await mockMongo.teardown()
}

export const initialiseServer = async () => {
  process.env.WASTE_CLIENT_AUTH_TEST_TOKEN = WASTE_CLIENT_AUTH_TEST_TOKEN
  process.env.WASTE_CLIENT_AUTH_TEST_1 = 'my test token 1'
  process.env.WASTE_CLIENT_AUTH_TEST_2 = 'my test token 2'
  updateClientAuthKeys()
  const mongoDb = await initInMemMongo()
  const server = await createServer({
    mongoDb
  })
  await server.initialize()
  return server
}

export const stopServer = async (server) => {
  await server.stop({ timeout: 0 })
  await stopInMemMongo()
}

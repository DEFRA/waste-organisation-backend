import * as mockMongo from 'vitest-mongodb'
import { createServer, plugins } from '../../api-server.js'

export const initialiseServer = async () => {
  await mockMongo.setup()
  const mongoDb = plugins.mongoDb
  if (globalThis?.__MONGO_URI__) {
    mongoDb.options.mongoUrl = globalThis.__MONGO_URI__
  }
  const server = await createServer({
    mongoDb
  })
  await server.initialize()
  return server
}

export const stopServer = async (server) => {
  await server.stop({ timeout: 0 })
  await mockMongo.teardown()
}

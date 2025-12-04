import { createServer, plugins } from '../../server.js'

export async function initialiseServer() {
  const mongoDb = plugins.mongoDb
  if (globalThis && globalThis.__MONGO_URI__) {
    mongoDb.options.mongoUrl = globalThis.__MONGO_URI__
  }
  const server = await createServer({
    mongoDb
  })
  await server.initialize()
  return server
}

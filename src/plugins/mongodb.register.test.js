import { up } from 'migrate-mongo'
import { mongoDb } from './mongodb.js'

/*
 * Exercise the mongoDb plugin register() directly with mocked dependencies so we can
 * drive the failure paths that the real in-memory server never hits: a migration that
 * throws (client must be closed and the error rethrown) and a client.close() that
 * rejects on stop (error must be logged, not thrown).
 *
 * Test is kept in its own file so the module mocks don't leak into the real-server tests in mongodb.test.js.
 */
const mongoClient = {
  db: vi.fn(() => ({ databaseName: 'test-db' })),
  close: vi.fn()
}

vi.mock('mongodb', () => ({
  MongoClient: { connect: vi.fn(async () => mongoClient) }
}))

vi.mock('migrate-mongo', () => ({
  config: { set: vi.fn() },
  up: vi.fn()
}))

vi.mock('./mongo-lock.js', () => ({
  createLockManager: vi.fn(async () => ({})),
  acquireLockWithWait: vi.fn(async () => ({ free: vi.fn() }))
}))

/* The real config module reads runtime config; stub it so importing the plugin has no side effects. */
vi.mock('../../migrate-mongo-config.js', () => ({ default: {} }))

const options = { mongoUrl: 'mongodb://mongo:27017', mongoOptions: {}, databaseName: 'test-db' }

const buildServer = () => {
  let onStop
  return {
    logger: { info: vi.fn(), error: vi.fn() },
    decorate: vi.fn(),
    events: {
      on: (event, handler) => {
        if (event === 'stop') {
          onStop = handler
        }
      }
    },
    triggerStop: async () => onStop()
  }
}

describe('#mongoDb register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    /* Default: migrations succeed with nothing pending, close resolves. */
    vi.mocked(up).mockResolvedValue([])
    mongoClient.close.mockResolvedValue(undefined)
  })

  test('closes the client and rethrows when a migration fails', async () => {
    const migrationError = new Error('migration boom')
    vi.mocked(up).mockRejectedValueOnce(migrationError)
    const server = buildServer()

    await expect(mongoDb.plugin.register(server, options)).rejects.toThrow(migrationError)
    expect(mongoClient.close).toHaveBeenCalledWith(true)
  })

  test('logs an error when closing the client fails on stop', async () => {
    const closeError = new Error('close failed')
    const server = buildServer()
    await mongoDb.plugin.register(server, options)

    mongoClient.close.mockRejectedValueOnce(closeError)
    await server.triggerStop()

    expect(server.logger.error).toHaveBeenCalledWith(closeError, 'failed to close mongo client')
  })
})

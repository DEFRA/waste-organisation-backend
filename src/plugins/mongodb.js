import { MongoClient } from 'mongodb'
import { config as migrateMongo, up } from 'migrate-mongo'
import { createLockManager, acquireLockWithWait } from './mongo-lock.js'
import migrateMongoConfig from '../../migrate-mongo-config.js'

const MIGRATION_LOCK = 'db-migrations'

export const mongoDb = {
  plugin: {
    name: 'mongodb',
    version: '1.0.0',
    register: async function (server, options) {
      server.logger.info('Setting up MongoDb')

      const client = await MongoClient.connect(options.mongoUrl, {
        ...options.mongoOptions
      })

      const databaseName = options.databaseName
      const db = client.db(databaseName)
      const locker = await createLockManager(db)

      /*
       * Run pending migrations before the service is ready.
       * changes are versioned migrations in the migrations/ root folder and run only once, not on every startup.
       * A failing migration throws here, which fails registration and so fails startup. Close the client we
       * opened on the way out so a failed startup doesn't leak the connection (ignore any close error so the
       * original migration failure is what propagates).
       */
      try {
        await runDbMigrations(db, server.logger, locker)
      } catch (e) {
        await client.close(true).catch(() => {})
        throw e
      }

      server.logger.info(`MongoDb connected to ${databaseName}`)

      server.decorate('server', 'mongoClient', client)
      server.decorate('server', 'db', db)
      server.decorate('server', 'locker', locker)
      server.decorate('request', 'db', () => db, { apply: true })
      server.decorate('request', 'locker', () => locker, { apply: true })

      server.events.on('stop', async () => {
        server.logger.info('Closing Mongo client')
        try {
          await client.close(true)
        } catch (e) {
          server.logger.error(e, 'failed to close mongo client')
        }
      })
    }
  }
}

/*
 * Runs pending migrate-mongo migrations with mongo-locks lock rather than migrate-mongo's as they're not safe. First pod runs migrations, any other pod waits
 */
export const runDbMigrations = async (db, logger, locker) => {
  const lockManager = locker ?? (await createLockManager(db))
  const migrationTimeoutMs = 120000
  const lock = await acquireLockWithWait(lockManager, MIGRATION_LOCK, logger, { timeoutMs: migrationTimeoutMs })
  try {
    migrateMongo.set(migrateMongoConfig)
    const migrated = await up(db)
    if (migrated.length > 0) {
      logger.info(`Applied db migrations: ${migrated.join(', ')}`)
    } else {
      logger.info('No pending db migrations')
    }
  } finally {
    await lock.free()
  }
}

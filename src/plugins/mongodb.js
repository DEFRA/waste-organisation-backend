import { MongoClient } from 'mongodb'
import { createOrgIndexes, setMissingCreatedAtAndUpdatedAtOrganisationFields } from '../repositories/organisation.js'
import { createSpreadsheetIndexes } from '../repositories/spreadsheet.js'
import { createPaymentIndexes } from '../repositories/payment.js'
import { createScheduledTasksIndexes } from '../repositories/scheduledTasks.js'
import { createLockManager, singletonRunner } from './mongo-lock.js'

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

      // Note: DB indexes are created and migrations are done during plugin initialisation
      await createIndexes(db)
      await runDbMigrations(db, server.logger)

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

async function createIndexes(db) {
  await db.collection('mongo-locks').createIndex({ id: 1 })
  await createOrgIndexes(db)
  await createSpreadsheetIndexes(db)
  await createPaymentIndexes(db)
  await createScheduledTasksIndexes(db)
}

export const runDbMigrations = async (db, logger) => {
  const logMigrationMsg = (label, l) => l.warn(`${label} - db migrations not running due to lock`)
  await singletonRunner(db, 'db migrations', logger, async () => await migrateDb(db, logger), logMigrationMsg)
}

const migrateDb = async (db, logger) => await setMissingCreatedAtAndUpdatedAtOrganisationFields(db, logger)

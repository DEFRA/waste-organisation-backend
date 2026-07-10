import { MongoClient, ObjectId } from 'mongodb'
import { LockManager } from 'mongo-locks'
import { createOrgIndexes } from '../repositories/organisation.js'
import { createSpreadsheetIndexes } from '../repositories/spreadsheet.js'
import { createPaymentIndexes } from '../repositories/payment.js'

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
      const locker = new LockManager(db.collection('mongo-locks'))

      // Note: DB indexes are created during plugin initialisation
      await createIndexes(db)

      await setMissingCreatedAtAndUpdatedAtOrganisationFields(db, server.logger)

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
}

/**
 * Finds Organisations with a missing or null createdAt field and adds createdAt and updatedAt
 * fields using the timestamp derived from the id or defaults to the current date/time, which
 * is unlikely as all ids should be ObjectId values.
 *
 * The idea is that this function is run once and then removed but as it only updates
 * Organisations which don't currently have a createdAt field, it can be run multiple times
 * without risk of overwriting existing data.
 *
 * This function runs on service startup so performance isn't tooo much of a concern and
 * operations are wrapped in a try/catch block which silences and logs any errors because if
 * these operations fail then the service probably shouldn't be prevented from starting.
 *
 * @param {Db} db - The Mongo database
 * @param {Object} logger - The logger
 *
 * @returns {Promise<void>}
 */
export async function setMissingCreatedAtAndUpdatedAtOrganisationFields(db, logger) {
  try {
    const collection = db.collection('organisations')
    const organisations = await collection.find({ $or: [{ createdAt: { $exists: false } }, { createdAt: null }] }).toArray()

    if (organisations.length > 0) {
      await Promise.all(
        organisations.map(({ _id }) => {
          const createdAt = _id instanceof ObjectId ? _id.getTimestamp() : new Date()
          return collection.updateOne({ _id }, { $set: { createdAt, updatedAt: createdAt } })
        })
      )
    }
  } catch (err) {
    logger.error(`Failed to set missing createdAt and updatedAt Organisation fields: ${err.message}`)
  }
}

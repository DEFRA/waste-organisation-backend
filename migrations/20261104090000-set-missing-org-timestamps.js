import { ObjectId } from 'mongodb'
import { orgCollection } from '../src/repositories/organisation.js'
import { createLogger } from '../src/common/helpers/logging/logger.js'

/**
 * Finds Organisations with a missing or null createdAt field and adds createdAt and updatedAt
 * fields using the timestamp derived from the id or defaults to the current date/time, which
 * is unlikely as all ids should be ObjectId values.
 *
 * This is invoked from the migration below, so it runs once (tracked in the changelog).
 * It only updates Organisations which don't currently have a createdAt field, so it is safe
 * to re-run without overwriting existing data. Errors are allowed to propagate: a failed
 * migration must fail service startup rather than be silently swallowed.
 *
 * @param {Db} db - The Mongo database
 * @param {Object} logger - The logger
 *
 * @returns {Promise<void>}
 */
export const setMissingCreatedAtAndUpdatedAtOrganisationFields = async (db, logger) => {
  const collection = db.collection(orgCollection)
  const q = { $or: [{ createdAt: { $exists: false } }, { createdAt: null }] }
  const organisations = await collection.find({ $or: [{ createdAt: { $exists: false } }, { createdAt: null }] }).toArray()

  if (organisations.length > 0) {
    await Promise.all(
      organisations.map(({ _id, organisationId }) => {
        if (_id instanceof ObjectId) {
          const createdAt = _id.getTimestamp()
          logger.info(`updating ${_id} - org id ${organisationId} createdAt to ${createdAt}`)
          return collection.updateOne({ _id, ...q }, { $set: { createdAt, updatedAt: createdAt } })
        } else {
          logger.warn(`setMissingCreatedAtAndUpdatedAtOrganisationFields: _id not instance of ObjectId : ${_id}`)
          return null
        }
      })
    )
  }
}

/*
 * Set createdAt/updatedAt on organisations that predate those fields,
 * deriving the timestamp from the ObjectId. Idempotent.
 */
export const up = async (db) => {
  await setMissingCreatedAtAndUpdatedAtOrganisationFields(db, createLogger())
}

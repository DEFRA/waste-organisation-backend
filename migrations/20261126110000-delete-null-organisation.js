import { orgCollection } from '../src/repositories/organisation.js'
import { createLogger } from '../src/common/helpers/logging/logger.js'

/**
 * Deletes organisations with null ID
 *
 * @param {Db} db - The Mongo database
 * @param {Object} logger - The logger
 *
 * @returns {Promise<void>}
 */
export const deleteOrganisationsWithNullId = async (db, logger) => {
  const collection = db.collection(orgCollection)

  // { organisationId: null } matches both a null and a missing organisationId.
  const orgs = await collection.find({ organisationId: null }).toArray()

  /*
   * There can't be more than one becauseof the unique constraint on org id, so if
   * there is, abort, something's wrong.
   */
  if (orgs.length > 1) {
    throw new Error(`migration delete-null-organisation: expected at most 1 organisation with null organisationId, found ${orgs.length}`)
  }

  if (orgs.length === 1) {
    // Log the org to be deleted so there's a full record
    logger.info(`migration delete-null-organisation: deleting organisation with null organisationId: ${JSON.stringify(orgs[0])}`)
    const { deletedCount } = await collection.deleteOne({ _id: orgs[0]._id })
    logger.info(`migration delete-null-organisation: deleted ${deletedCount} organisation`)
  }
}

/*
 * Delete organisations without an organisationId: they can't be looked up or
 * used, so are left over from bad data. Idempotent.
 */
export const up = async (db) => {
  await deleteOrganisationsWithNullId(db, createLogger())
}

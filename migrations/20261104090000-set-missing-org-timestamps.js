import { setMissingCreatedAtAndUpdatedAtOrganisationFields } from '../src/repositories/organisation.js'
import { createLogger } from '../src/common/helpers/logging/logger.js'

/*
 * Set createdAt/updatedAt on organisations that predate those fields,
 * deriving the timestamp from the ObjectId. Idempotent.
 */
export const up = async (db) => {
  await setMissingCreatedAtAndUpdatedAtOrganisationFields(db, createLogger())
}

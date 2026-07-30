import { ObjectId } from 'mongodb'

export const orgCollection = 'organisations'

export const createOrgIndexes = async (db) => {
  await db.collection(orgCollection).createIndex({ users: 1, organisationId: 1 })
  await db.collection(orgCollection).createIndex({ 'apiCodes.code': 1 }, { unique: true })
  await db.collection(orgCollection).createIndex({ createdAt: -1 })
}

export const findOrganisationById = (db, orgId) => {
  return db.collection(orgCollection).findOne({ organisationId: { $eq: orgId } }, { projection: { _id: 0 } })
}

export const findOrganisationByApiCode = (db, apiCode) => {
  return db.collection(orgCollection).findOne({ 'apiCodes.code': { $eq: apiCode } }, { projection: { _id: 0 } })
}

export const findOrganisationsByDateRange = (db, startDate, endDate) => {
  const inclusiveStartDate = new Date(startDate)
  inclusiveStartDate.setUTCHours(0, 0, 0, 0)

  // Exclusive upper bound at the start of the day after endDate, so the whole of endDate is included
  const exclusiveEndDate = new Date(endDate)
  exclusiveEndDate.setUTCHours(0, 0, 0, 0)
  exclusiveEndDate.setUTCDate(exclusiveEndDate.getUTCDate() + 1)

  return db
    .collection(orgCollection)
    .aggregate([
      { $match: { createdAt: { $gte: inclusiveStartDate, $lt: exclusiveEndDate } } },
      {
        $project: {
          _id: 0,
          organisationId: 1,
          dateRegistered: '$createdAt',
          activeApiCodeCount: {
            $size: {
              $filter: {
                input: { $ifNull: ['$apiCodes', []] },
                cond: { $eq: ['$$this.isDisabled', false] }
              }
            }
          }
        }
      },
      { $sort: { dateRegistered: -1, organisationId: -1 } }
    ])
    .toArray()
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
export const setMissingCreatedAtAndUpdatedAtOrganisationFields = async (db, logger) => {
  try {
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
  } catch (err) {
    logger.error(`Failed to set missing createdAt and updatedAt Organisation fields: ${err.message}`)
  }
}

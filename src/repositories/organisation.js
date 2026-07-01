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

  const inclusiveEndDate = new Date(endDate)
  inclusiveEndDate.setUTCHours(23, 59, 59, 999)

  return db
    .collection(orgCollection)
    .aggregate([
      { $match: { createdAt: { $gte: inclusiveStartDate, $lte: inclusiveEndDate } } },
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

export const orgCollection = 'organisations'

export const createOrgIndexes = async (db) => {
  await db
    .collection(orgCollection)
    .createIndex({ users: 1, organisationId: 1 })
  await db.collection(orgCollection).createIndex({ 'apiCodes.code': 1 })
}

export const findAllOrganisationsForUser = (db, userId) => {
  const cursor = db
    .collection(orgCollection)
    .find(
      { users: { $elemMatch: { $eq: userId } } },
      { projection: { _id: 0 } }
    )
  return cursor.toArray()
}

export const findOrganisationById = (db, orgId) => {
  return db
    .collection(orgCollection)
    .findOne({ organisationId: { $eq: orgId } }, { projection: { _id: 0 } })
}

export const orgCollection = 'organisations'

export const createOrgIndexes = async (db) => {
  await db.collection(orgCollection).createIndex({ users: 1, organisationId: 1 })
  await db.collection(orgCollection).createIndex({ 'apiCodes.code': 1 }, { unique: true })
}

export const findOrganisationById = (db, orgId) => {
  return db.collection(orgCollection).findOne({ organisationId: { $eq: orgId } }, { projection: { _id: 0 } })
}

export const findOrganisationByApiCode = (db, apiCode) => {
  return db.collection(orgCollection).findOne({ 'apiCodes.code': { $eq: apiCode } }, { projection: { _id: 0 } })
}

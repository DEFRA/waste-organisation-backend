export const orgCollection = 'organisations'

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

export const saveOrganisation = (db, orgId, org) => {
  return db.collection(orgCollection).updateOne(
    { organisationId: orgId },
    {
      $set: org
    },
    {
      upsert: true
    }
  )
}

// TODO handle transactions
export const updateOrganisation = (db, orgId, func) => {
  return db.runCommand({
    findAndModify: orgCollection,
    query: { organisationId: orgId },
    update: {},
    upsert: true,
    new: true
  })
}

export const createOrganisationIndexes = async (db) => {
  await db.collection(orgCollection).createIndex({ users: 1 })
  await db
    .collection(orgCollection)
    .createIndex({ organisationId: 1 }, { unique: true })
}

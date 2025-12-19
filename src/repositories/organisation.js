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
// { organisationId: orgId } ... { organisationId: { $eq: orgId } }
export const updateOrganisation = async (client, databaseName, query, func) => {
  const session = client.startSession()
  await session.withTransaction(async () => {
    try {
      const db = client.db(databaseName)
      const dbOrg = db
        .collection(orgCollection)
        .findOne(query, { projection: { _id: 0 }, session })
      const org = func(dbOrg)
      if (org) {
        await db.collection(orgCollection).updateOne(
          { organisationId: org.organisationId },
          {
            $set: org
          },
          {
            upsert: true,
            session
          }
        )
      }
    } finally {
      await session.endSession()
    }
  })
}

export const createOrganisationIndexes = async (db) => {
  const u = { unique: true }
  await db.collection(orgCollection).createIndex({ users: 1 })
  await db.collection(orgCollection).createIndex({ organisationId: 1 }, u)
  await db.collection(orgCollection).createIndex({ 'connections.id': 1 })
}

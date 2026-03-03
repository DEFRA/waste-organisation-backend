export const spreadsheetCollection = 'spreadsheets'

export const createSpreadsheetIndexes = async (db) => {
  await db.collection(spreadsheetCollection).createIndex({ organisationId: 1, uploadId: 1 })
  await db.collection(spreadsheetCollection).createIndex({ organisationId: 1, filename: 1 })
}

export const findUploadIdsByFilename = (db, organisationId, filename) => {
  return db
    .collection(spreadsheetCollection)
    .find({ organisationId: { $eq: organisationId }, filename: { $eq: filename } }, { projection: { _id: 0, uploadId: 1 } })
    .toArray()
}

export const findAllSpreadsheets = (db, orgId, uploadId) => {
  const q = { organisationId: { $eq: orgId } }
  if (uploadId) {
    q.uploadId = { $eq: uploadId }
  }
  const cursor = db.collection(spreadsheetCollection).find(q, { projection: { _id: 0 } })
  return cursor.toArray()
}

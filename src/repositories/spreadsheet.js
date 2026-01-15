export const spreadsheetCollection = 'spreadsheets'

export const createSpreadsheetIndexes = async (db) => {
  await db
    .collection(spreadsheetCollection)
    .createIndex({ organisationId: 1, uploadId: 1 })
}

export const findAllSpreadsheets = (db, orgId, uploadId) => {
  const q = { organisationId: { $eq: orgId } }
  if (uploadId) q.uploadId = { $eq: uploadId }
  const cursor = db
    .collection(spreadsheetCollection)
    .find(q, { projection: { _id: 0 } })
  return cursor.toArray()
}

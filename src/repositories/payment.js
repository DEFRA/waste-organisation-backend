export const paymentCollection = 'payments'

export const createPaymentIndexes = async (db) => {
  await db.collection(paymentCollection).createIndex({ organisationId: 1 })
  await db.collection(paymentCollection).createIndex({ organisationId: 1, period: 1 })
  await db.collection(paymentCollection).createIndex({ paymentId: 1 }, { unique: true })
}

export const findMatchingPayments = async (db, organisationId, period) => {
  return await db.collection(paymentCollection).findOne({ organisationId, period })
}

export const createStubPayment = async (db, organisationId, period, idempotencyKey) => {
  return await db.collection(paymentCollection).insertOne({ organisationId, period, idempotencyKey })
}

export const deleteStubPayment = async (db, organisationId, idempotencyKey) => {
  return await db.collection(paymentCollection).deleteOne({ organisationId, idempotencyKey })
}

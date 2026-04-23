export const paymentCollection = 'payments'

export const createPaymentIndexes = async (db) => {
  await db.collection(paymentCollection).createIndex({ organisationId: 1 })
  await db.collection(paymentCollection).createIndex({ paymentId: 1 }, { unique: true })
}

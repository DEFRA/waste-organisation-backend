export const paymentCollection = 'payments'

export const findMatchingPayments = async (db, organisationId, period) => {
  return await db
    .collection(paymentCollection)
    .find({ organisationId, period }, { projection: { _id: 0 } })
    .toArray()
}

export const createStubPayment = async (db, organisationId, period, idempotencyKey) => {
  return await db.collection(paymentCollection).insertOne({ organisationId, period, idempotencyKey, paymentId: `TMP-${idempotencyKey}` })
}

export const deleteStubPayment = async (db, organisationId, idempotencyKey) => {
  return await db.collection(paymentCollection).deleteOne({ organisationId, idempotencyKey })
}

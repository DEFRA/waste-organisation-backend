import { orgCollection } from '../src/repositories/organisation.js'
import { spreadsheetCollection } from '../src/repositories/spreadsheet.js'
import { paymentCollection } from '../src/repositories/payment.js'
import { scheduledTasksCollection } from '../src/repositories/scheduledTasks.js'

/*
 * Base indexes. Idempotent.
 * These index builders only ever ran from this migration, so they live here rather than in
 * the repositories. The collection-name constants stay in the repositories (their queries
 * still use them) and are imported to avoid duplicating the names.
 */
const createOrgIndexes = async (db) => {
  await db.collection(orgCollection).createIndex({ users: 1, organisationId: 1 })
  await db.collection(orgCollection).createIndex({ 'apiCodes.code': 1 }, { unique: true })
  await db.collection(orgCollection).createIndex({ createdAt: -1 })
}

const createSpreadsheetIndexes = async (db) => {
  await db.collection(spreadsheetCollection).createIndex({ organisationId: 1, uploadId: 1 })
  await db.collection(spreadsheetCollection).createIndex({ organisationId: 1, filename: 1 })
}

const createPaymentIndexes = async (db) => {
  await db.collection(paymentCollection).createIndex({ organisationId: 1 })
  await db.collection(paymentCollection).createIndex({ organisationId: 1, period: 1 })
  await db.collection(paymentCollection).createIndex({ paymentId: 1 }, { unique: true })
}

const createScheduledTasksIndexes = async (db) => {
  await db.collection(scheduledTasksCollection).createIndex({ name: 1 })
}

export const up = async (db) => {
  await createOrgIndexes(db)
  await createSpreadsheetIndexes(db)
  await createPaymentIndexes(db)
  await createScheduledTasksIndexes(db)
}

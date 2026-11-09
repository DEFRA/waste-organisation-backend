import { createOrgIndexes } from '../src/repositories/organisation.js'
import { createSpreadsheetIndexes } from '../src/repositories/spreadsheet.js'
import { createPaymentIndexes } from '../src/repositories/payment.js'
import { createScheduledTasksIndexes } from '../src/repositories/scheduledTasks.js'

/*
 * Base indexes. Idempotent.
 */
export const up = async (db) => {
  await createOrgIndexes(db)
  await createSpreadsheetIndexes(db)
  await createPaymentIndexes(db)
  await createScheduledTasksIndexes(db)
}

import Excel from 'exceljs'
import { createLogger } from '../common/helpers/logging/logger.js'

/* v8 ignore start */
const logger = createLogger()

export const parseExcelFile = async (buffer) => {
  const workbook = new Excel.Workbook()
  await workbook.xlsx.load(buffer)
  workbook.eachSheet((worksheet, _sheetId) => {
    logger.info(`worksheet ${worksheet.name}`)
  })
  return workbook
}
/* v8 ignore stop */

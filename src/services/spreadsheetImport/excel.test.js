import fs from 'node:fs/promises'
import { parseExcelFile, transformBulkApiErrors, updateCellContent, wasteTrackingIdsToCoords } from '../spreadsheetImport.js'
import { updateErrors } from './excel.js'
import Excel from 'exceljs'

describe('excel proccessor', () => {
  beforeAll(() => {
    vi.clearAllMocks()
  })

  test('errors should be added to the correct cells', { timeout: 50000 }, async () => {
    const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
    const { workbook } = await parseExcelFile(buffer)
    const worksheetName = '7. Waste movement level'
    const worksheet = workbook.getWorksheet(worksheetName)

    const errors = {
      '7. Waste movement level': [
        {
          coords: [3, 9],
          message: 'ewc codes must be a valid EWC code from the official list',
          errorValue: ['060110'],
          sheet: '8. Waste item level'
        },
        {
          coords: [16, 9],
          message: 'concentration must be a number',
          errorValue: [
            { name: 'Hydrochloric Acid', concentration: '<=37%' },
            { name: 'Water', concentration: 'Balance' }
          ],
          sheet: '8. Waste item level'
        }
      ]
    }

    updateErrors(workbook, errors)
    const cell1 = worksheet.getRow(9).getCell(1)
    expect(cell1.value.richText[0].text).toBe('ewc codes must be a valid EWC code from the official list (C9)')
  })
})

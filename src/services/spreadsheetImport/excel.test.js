import fs from 'node:fs/promises'
import { parseExcelFile, updateCellContent } from '../spreadsheetImport.js'
import { updateErrors, worksheetToArray } from './excel.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { randomUUID } from 'node:crypto'

const logger = createLogger()

describe('excel proccessor', () => {
  beforeAll(() => {
    vi.clearAllMocks()
  })

  test('errors should be added to the correct cells', { timeout: 50000 }, async () => {
    const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
    const { workbook } = await parseExcelFile(buffer, 'org-id', logger)
    const worksheet = workbook.getWorksheet('7. Waste movement level')

    const errors = {
      '7. Waste movement level': [
        {
          coords: [3, 9],
          message: 'ewc codes must be a valid EWC code from the official list',
          errorValue: ['060110']
        },
        {
          coords: [16, 9],
          message: 'concentration must be a number',
          errorValue: [
            { name: 'Hydrochloric Acid', concentration: '<=37%' },
            { name: 'Water', concentration: 'Balance' }
          ]
        }
      ],
      '8. Waste item level': [
        {
          coords: [null, 9],
          message: 'Fishy Error',
          errorValue: null
        },
        {
          message: 'Dodgy Error',
          errorValue: null
        }
      ]
    }

    updateErrors(workbook, errors, { firstRowOfData: 9, errors: { '7. Waste movement level': 1, '8. Waste item level': 1 } })
    const cell1 = worksheet.getRow(9).getCell(1)
    expect(cell1.value.richText[0].text).toBe('ewc codes must be a valid EWC code from the official list (C9)')

    const worksheet2 = workbook.getWorksheet('8. Waste item level')
    const cell2 = worksheet2.getRow(9).getCell(1)
    expect(cell2.value.richText.map(({ text }) => text)).toEqual(['Fishy Error', '\nDodgy Error'])
  })

  test('ignores a data row whose only key-column content is whitespace', () => {
    const worksheet = {
      eachRow: (callback) => {
        callback(
          {
            getCell: (col) => ({ value: col === 4 ? ' ' : null }),
            eachCell: () => {}
          },
          9
        )
      }
    }

    const { elements, errors } = worksheetToArray({
      worksheet,
      keyCols: [3, 4, 5, 6, 7],
      updateFn: () => {},
      minRow: 8,
      maxCol: 30
    })

    expect(elements).toEqual([])
    expect(errors).toEqual([])
  })

  test('highlights only the failed cell when other cells share its style', () => {
    const sharedStyle = {}
    const cells = {
      1: { value: null, style: {} },
      3: { value: 'AB12 CDE', style: sharedStyle },
      4: { value: 'Road', style: sharedStyle }
    }
    const workbook = {
      getWorksheet: () => ({
        getRow: () => ({
          getCell: (col) => cells[col]
        })
      })
    }

    updateErrors(workbook, {
      '7. Waste movement level': [{ coords: [3, 9], message: 'vehicle registration is invalid' }]
    })

    expect(cells[3].style.fill.fgColor.argb).toBe('FFFFCCCC')
    expect(cells[4].style).toBe(sharedStyle)
    expect(sharedStyle.fill).toBeUndefined()
  })

  test("excel worksheets disappearing during processing get logged and don't throw errors", () => {
    const x = randomUUID()
    expect(updateCellContent({ worksheets: [{ name: 'alice' }], getWorksheet: () => null, x }, { bob: null }, console).x).toBe(x)
    expect(updateErrors({ worksheets: [{ name: 'alice' }], getWorksheet: () => null, x }, { bob: null }, console).x).toBe(x)
  })
})

import { vi } from 'vitest'
import fs from 'node:fs/promises'
import { parseExcelFile, transformBulkApiErrors, updateErrors, workbookToByteArray, wasteTrackingIdsToCoords, updateCellContent } from './spreadsheetImport.js'
import { v4 as uuidv4 } from 'uuid'

const conf = {
  endpoint: 'http://localhost:3002',
  url: '/bulk/{bulkUploadId}/movements/receive',
  // password is also in compose.yml file
  basicAuth: { username: 'waste-organisations-backend', password: '92fa681e-44b4-4b9c-8f7a-59c117757452' }
}

describe.skip('bulk import api calls data - requires service dependencies to be running', () => {
  test('should import some data', { timeout: 50000 }, async () => {
    const { bulkImport } = await import('./bulkImport.js')
    const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
    const { movements } = await parseExcelFile(buffer, '8194cecf-da10-4698-aaaf-f06d2e54ac44')

    const res = await bulkImport('abc1234', movements, conf)
    expect(res.errors).toBe(undefined)
  })

  test('should update waste tracking IDs', { timeout: 50000 }, async () => {
    // const { bulkImport } = await import('./bulkImport.js')
    const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
    const { rowNumbers, movements } = await parseExcelFile(buffer, uuidv4().toString())
    expect(movements.length).toBe(1)
    // const res = await bulkImport(uuidv4().toString(), movements, conf)
    const res = { movements: [{ wasteTrackingId: '26WR8B1H' }] }
    const coords = wasteTrackingIdsToCoords(movements, rowNumbers, res.movements)
    expect(coords).toEqual([])
  })
})

describe('mock bulk import data', () => {
  const wreckPostMock = vi.fn()
  const wreckPutMock = vi.fn()

  beforeAll(() => {
    vi.doMock('@hapi/wreck', () => ({
      default: {
        post: wreckPostMock.mockReturnValue({ payload: { post: 'response' } }),
        put: wreckPutMock.mockReturnValue({ payload: { put: 'response' } })
      }
    }))
  })

  test('should update waste tracking IDs', { timeout: 50000 }, async () => {
    // const { bulkImport } = await import('./bulkImport.js')
    const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
    const { hasErrors, workbook, movements, rowNumbers, errors } = await parseExcelFile(buffer, uuidv4().toString())
    expect(movements.length).toBe(1)
    expect(errors).toEqual({ items: [], movements: [] })
    expect(hasErrors).toEqual(false)
    const bulkImportResult = { movements: [{ wasteTrackingId: '26WR8B1H' }] }
    const coords = wasteTrackingIdsToCoords(movements, rowNumbers, bulkImportResult.movements)
    expect(coords).toEqual({
      '7. Waste movement level': [
        {
          coords: [2, 9],
          sheet: '7. Waste movement level',
          value: '26WR8B1H'
        }
      ]
    })
    updateCellContent(workbook, coords)
  })

  test('should import some data', { timeout: 100000 }, async () => {
    wreckPostMock.mockReturnValue({
      payload: { errors: [] }
    })

    const { bulkImport } = await import('./bulkImport.js')

    const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
    const { movements } = await parseExcelFile(buffer, '8194cecf-da10-4698-aaaf-f06d2e54ac44')

    const res = await bulkImport('abc1234', movements, conf)
    expect(res.errors).toBe(undefined)
  })
})

describe('Error transforms bulk import data', () => {
  test.each([
    [
      './test-resources/example-spreadsheet.xlsx',
      [
        {
          errorType: 'UnexpectedError',
          key: '0.wasteItems.0.ewcCodes.0',
          message: '"[0].wasteItems[0].ewcCodes[0]" must be a valid EWC code from the official list'
        },
        {
          errorType: 'UnexpectedError',
          key: '0.wasteItems.0.hazardous.components.0.concentration',
          message: '"[0].wasteItems[0].hazardous.components[0].concentration" must be a number'
        },
        {
          errorType: 'UnexpectedError',
          key: '0.wasteItems.0.hazardous.components.1.concentration',
          message: '"[0].wasteItems[0].hazardous.components[1].concentration" must be a number'
        },
        {
          errorType: 'UnexpectedError',
          key: '0.carrier.meansOfTransport',
          message: '"[0].carrier.meansOfTransport" is required'
        },
        {
          errorType: 'UnexpectedError',
          key: '0.receiver.authorisationNumber',
          message: '"[0].receiver.authorisationNumber" is required'
        }
      ],
      {
        '7. Waste movement level': [
          {
            coords: [9, 22],
            message: 'means of transport is required',
            sheet: '7. Waste movement level'
          },
          {
            coords: [9, 7],
            message: 'authorisation number is required',
            sheet: '7. Waste movement level'
          }
        ],
        '8. Waste item level': [
          {
            coords: [9, 3],
            errorValue: ['060110'],
            message: 'ewc codes must be a valid EWC code from the official list',
            sheet: '8. Waste item level'
          },
          {
            coords: [9, 16],
            errorValue: [
              {
                concentration: '<=37%',
                name: 'Hydrochloric Acid'
              },
              {
                concentration: 'Balance',
                name: 'Water'
              }
            ],
            message: 'concentration must be a number',
            sheet: '8. Waste item level'
          }
        ]
      }
    ],
    [
      './test-resources/c3c82719-b0a3-4703-b90e-203ca0c8c2fd.xlsx',
      [
        {
          key: '0.hazardousWasteConsignmentCode',
          errorType: 'UnexpectedError',
          message:
            '"[0].hazardousWasteConsignmentCode" must be in one of the valid formats: EA/NRW (e.g. CJTILE/A0001), SEPA (SA|SB|SC followed by 7 digits), or NIEA (DA|DB|DC followed by 7 digits)'
        },
        {
          key: '0.wasteItems.0.disposalOrRecoveryCodes.0.weight.amount',
          errorType: 'UnexpectedError',
          message: '"[0].wasteItems[0].disposalOrRecoveryCodes[0].weight.amount" must be a number'
        },
        {
          key: '0.wasteItems.1.hazardous.sourceOfComponents',
          errorType: 'UnexpectedError',
          message: '"[0].wasteItems[1].hazardous.sourceOfComponents" must be one of [PROVIDED_WITH_WASTE, GUIDANCE, OWN_TESTING, NOT_PROVIDED]'
        },
        { key: '0.carrier.emailAddress', errorType: 'UnexpectedError', message: '"[0].carrier.emailAddress be in valid UK or Ireland format' },
        { key: '0.carrier.phoneNumber', errorType: 'UnexpectedError', message: '"[0].carrier.phoneNumber" must be a string' }
      ],
      {}
    ]
  ])('should convert error messages from data import', { timeout: 100000 }, async (fileName, errors, result) => {
    const buffer = await fs.readFile(fileName)
    const { hasErrors, movements, rowNumbers } = await parseExcelFile(buffer, '8194cecf-da10-4698-aaaf-f06d2e54ac44')

    expect(hasErrors).toBe(true)
    const e = transformBulkApiErrors(movements, rowNumbers, errors)
    expect(e).toEqual(result)
  })
})

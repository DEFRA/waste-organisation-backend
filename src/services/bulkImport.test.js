import { vi } from 'vitest'
import fs from 'node:fs/promises'
import { parseExcelFile, transformBulkApiErrors, updateErrors, workbookToByteArray } from './spreadsheetImport.js'

const conf = {
  endpoint: 'http://localhost:3002',
  url: '/bulk/{{bulkUploadId}}/movements/receive',
  // password is also in compose.yml file
  basicAuth: { username: 'waste-organisations-backend', password: '92fa681e-44b4-4b9c-8f7a-59c117757452' }
}

describe('bulk import api calls data - requires service dependencies to be running', () => {
  test.skip('should import some data', { timeout: 50000 }, async () => {
    const { bulkImport } = await import('./bulkImport.js')
    const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
    const { movements } = await parseExcelFile(buffer, '8194cecf-da10-4698-aaaf-f06d2e54ac44')

    const res = await bulkImport('abc1234', movements, conf)
    expect(res.errors).toBe(undefined)
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
  test('should convert error messages from data import', { timeout: 100000 }, async () => {
    const buffer = await fs.readFile('./test-resources/example-spreadsheet.xlsx')
    const { hasErrors, workbook, movements, rowNumbers } = await parseExcelFile(buffer, '8194cecf-da10-4698-aaaf-f06d2e54ac44')

    expect(hasErrors).toBe(true)
    // const res = await bulkImport('abc1234', movements, conf)
    const errors = [
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
    ]
    const e = transformBulkApiErrors(movements, rowNumbers, errors)
    expect(e).toEqual({
      '7. Waste movement level': [
        {
          coords: [9, 23],
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
    })
    updateErrors(workbook, e)
    expect(await workbookToByteArray(workbook)).toBeInstanceOf(Buffer)
  })
})

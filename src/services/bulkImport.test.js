import fs from 'node:fs/promises'
import { bulkImport } from './bulkImport.js'
import { parseExcelFile, transformBulkApiErrors } from './spreadsheetImport.js'

describe('bulk import data', () => {
  test('should import some data', { timeout: 50000 }, async () => {
    const conf = {
      endpoint: 'http://localhost:3002',
      url: '/bulk/{{bulkUploadId}}/movements/receive',
      basicAuth: { username: 'waste-organisations-backend', password: '92fa681e-44b4-4b9c-8f7a-59c117757452' }
    }
    const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
    const { movements } = await parseExcelFile(buffer, '8194cecf-da10-4698-aaaf-f06d2e54ac44')

    const res = await bulkImport('abc1234', movements, conf)
    expect(res.errors).toBe(undefined)
  })

  test('should convert error messages from data import', { timeout: 50000 }, async () => {
    const conf = {
      endpoint: 'http://localhost:3002',
      url: '/bulk/{{bulkUploadId}}/movements/receive',
      basicAuth: { username: 'waste-organisations-backend', password: '92fa681e-44b4-4b9c-8f7a-59c117757452' }
    }
    const buffer = await fs.readFile('./test-resources/example-spreadsheet.xlsx')
    const { movements, rowNumbers } = await parseExcelFile(buffer, '8194cecf-da10-4698-aaaf-f06d2e54ac44')

    const res = await bulkImport('abc1234', movements, conf)
    expect(transformBulkApiErrors(movements, rowNumbers, res.errors)).toEqual([
      {
        coords: [9, 3],
        errorValue: ['060110'],
        message: 'ewc codes must be a valid EWC code from the official list'
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
        message: 'concentration must be a number'
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
        message: 'concentration must be a number'
      },
      {
        coords: [9, 23],
        message: 'means of transport is required'
      },
      {
        coords: [9, 7],
        message: 'authorisation number is required'
      }
    ])

    expect(res.errors).toEqual([
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
    ])
  })
})

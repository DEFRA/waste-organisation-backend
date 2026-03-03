import { vi } from 'vitest'
import fs from 'node:fs/promises'
import { parseExcelFile, transformBulkApiErrors, updateErrors, wasteTrackingIdsToCoords, updateCellContent } from './spreadsheetImport.js'
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

  test('bulkUpdate should use PUT method', { timeout: 100000 }, async () => {
    wreckPutMock.mockReturnValue({
      payload: { movements: [{ wasteTrackingId: 'ABC123' }] }
    })

    const { bulkUpdate } = await import('./bulkImport.js')

    const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
    const { movements } = await parseExcelFile(buffer, '8194cecf-da10-4698-aaaf-f06d2e54ac44')
    movements[0].wasteTrackingId = 'ABC123'

    const res = await bulkUpdate('abc1234', movements, conf)
    expect(res.movements).toEqual([{ wasteTrackingId: 'ABC123' }])
    expect(wreckPutMock).toHaveBeenCalled()
  })

  test('should expect some errors', { timeout: 100000 }, async () => {
    wreckPostMock.mockImplementation(async () => {
      // eslint-disable-next-line no-throw-literal
      throw {
        output: { statusCode: 400 },
        data: { payload: [{}, { validation: { errors: [{ message: 1 }] } }, { validation: { errors: [{ message: 2 }, { message: 3 }] } }] }
      }
    })

    const { bulkImport } = await import('./bulkImport.js')

    const res = await bulkImport('abc1234', testMovements, conf)
    expect(res.errors).toEqual([{ message: 1 }, { message: 2 }, { message: 3 }])
  })

  test('should throw on transient error (503)', { timeout: 100000 }, async () => {
    wreckPostMock.mockImplementation(async () => {
      // eslint-disable-next-line no-throw-literal
      throw { output: { statusCode: 503 } }
    })

    const { bulkImport } = await import('./bulkImport.js')

    await expect(bulkImport('abc1234', testMovements, conf)).rejects.toEqual({ output: { statusCode: 503 } })
  })

  test('should return failed for non-transient error (500)', { timeout: 100000 }, async () => {
    wreckPostMock.mockImplementation(async () => {
      // eslint-disable-next-line no-throw-literal
      throw { output: { statusCode: 500 } }
    })

    const { bulkImport } = await import('./bulkImport.js')

    const res = await bulkImport('abc1234', testMovements, conf)
    expect(res).toEqual({ failed: true })
  })

  test('should return failed for network error without status code', { timeout: 100000 }, async () => {
    wreckPostMock.mockImplementation(async () => {
      throw new Error('ECONNREFUSED')
    })

    const { bulkImport } = await import('./bulkImport.js')

    const res = await bulkImport('abc1234', testMovements, conf)
    expect(res).toEqual({ failed: true })
  })
})

describe('Error transforms bulk import data', () => {
  test.each([
    [
      './test-resources/example-spreadsheet-3.xlsx',
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
    ]
  ])('should convert error messages from data import', { timeout: 100000 }, async (fileName, errs, result) => {
    console.log('fileName: ', fileName)
    const buffer = await fs.readFile(fileName)
    const { workbook, hasErrors, movements, rowNumbers, errors } = await parseExcelFile(buffer, '8194cecf-da10-4698-aaaf-f06d2e54ac44')
    if (hasErrors) {
      expect({ fileName, errors, movements, rowNumbers, hasErrors }).toBe({})
    }
    const e = transformBulkApiErrors(movements, rowNumbers, errs)
    expect(e).toEqual(result)
    updateErrors(workbook, e)
    await workbook.xlsx.writeFile(fileName.replace(/xlsx/, 'with-api-errors.xlsx'))
  })
})

const testMovements = [
  {
    carrier: {
      meansOfTransport: 'Inland Waterway',
      organisationName: 'Qualitech Environmental Services Ltd',
      registrationNumber: 'CBDU171976'
    },
    dateTimeReceived: new Date('2026-01-14T11:05:00.000Z'),
    hazardousWasteConsignmentCode: 'KAWASA/19963',
    receipt: {
      address: {
        fullAddress: 'Ernesettle Lane, Plumouth',
        postcode: 'PL5 2SA'
      }
    },
    receiver: {
      authorisationNumber: 'XX9999XX',
      siteName: 'Kawasaki Precision Machinery UK Ltd'
    },
    submittingOrganisation: {
      defraCustomerOrganisationId: '8194cecf-da10-4698-aaaf-f06d2e54ac44'
    },
    wasteItems: [
      {
        containsHazardous: true,
        containsPops: false,
        disposalOrRecoveryCodes: [
          {
            code: 'D9',
            weight: {
              amount: 10000,
              isEstimate: true,
              metric: 'Kilograms'
            }
          }
        ],
        ewcCodes: ['060101'],
        hazardous: {
          components: [
            {
              concentration: 37,
              name: 'Hydrochloric Acid'
            },
            {
              concentration: 9963,
              name: 'Water'
            }
          ],
          hazCodes: ['HP_5', 'HP_8'],
          sourceOfComponents: 'PROVIDED_WITH_WASTE'
        },
        numberOfContainers: 1,
        physicalForm: 'Liquid',
        typeOfContainers: 'TAN',
        wasteDescription: 'Hydrochloric Pickling Acid',
        weight: {
          amount: 10000,
          isEstimate: true,
          metric: 'Kilograms'
        }
      },
      {
        containsHazardous: true,
        containsPops: false,
        disposalOrRecoveryCodes: [
          {
            code: 'R13',
            weight: {
              amount: 2850,
              isEstimate: true,
              metric: 'Kilograms'
            }
          }
        ],
        ewcCodes: ['150110'],
        hazardous: {
          components: [
            {
              concentration: '<1%',
              name: '2-dibutylaminoethanol (5-<7%)'
            },
            {
              concentration: '<1%',
              name: 'Talc (3-<5%)'
            },
            {
              concentration: '<1%',
              name: 'Non-hazardous ink components (Balance)'
            },
            {
              concentration: 'Balance',
              name: 'Metal tins and rags'
            }
          ],
          hazCodes: ['HP_8'],
          sourceOfComponents: 'PROVIDED_WITH_WASTE'
        },
        numberOfContainers: 19,
        physicalForm: 'Solid',
        typeOfContainers: 'WBI',
        wasteDescription: 'Empty tins and rags c/w ink',
        weight: {
          amount: 2850,
          isEstimate: true,
          metric: 'Kilograms'
        }
      },
      {
        containsHazardous: true,
        containsPops: false,
        disposalOrRecoveryCodes: [
          {
            code: 'R13',
            weight: {
              amount: 75,
              isEstimate: true,
              metric: 'Kilograms'
            }
          }
        ],
        ewcCodes: ['140603'],
        hazardous: {
          components: [
            {
              concentration: '100%',
              name: 'Acetone'
            }
          ],
          hazCodes: ['HP_3', 'HP_4'],
          sourceOfComponents: 'PROVIDED_WITH_WASTE'
        },
        numberOfContainers: 3,
        physicalForm: 'Liquid',
        typeOfContainers: 'DRU',
        wasteDescription: 'Acetone',
        weight: {
          amount: 75,
          isEstimate: true,
          metric: 'Kilograms'
        }
      }
    ],
    yourUniqueReference: 'KAWASA/19963'
  }
]

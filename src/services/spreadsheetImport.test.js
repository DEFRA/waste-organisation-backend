import fs from 'node:fs/promises'
import { parseExcelFile, transformBulkApiErrors, updateCellContent, wasteTrackingIdsToCoords } from './spreadsheetImport.js'
import {
  parseBoolean,
  parseComponentCodes,
  parseComponentNames,
  parseContainerType,
  parseDisposalCodes,
  parseEstimate,
  parseEWCCodes,
  parseHazCodes,
  parseRegStatements,
  parseTitleCase,
  parseToString
} from './spreadsheetImport/parsers.js'
import { appendMessageToCell, cellValueText } from './spreadsheetImport/excel.js'
import {
  coerceRegistrationNumberWhenReasonSupplied,
  validateMovementHasWasteItems,
  validateWasteTrackingIdExists,
  validateWasteTrackingIdMissing,
  populateWholeItemDisposalCodes
} from './spreadsheetImport/transforms.js'
import { expect } from 'vitest'
import * as excelImportModule from './spreadsheetImport/excel.js'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

describe('some unit tests for parsers', () => {
  test('ewc codes can be numbers', () => {
    expect(parseEWCCodes(null, '01 01 01')).toEqual(['010101'])
    expect(parseEWCCodes(null, '01 01 01;010101')).toEqual(['010101', '010101'])
    expect(parseEWCCodes(null, 101010)).toEqual(['101010'])
    expect(parseEWCCodes([], 101010)).toEqual(['101010'])
    expect(parseEWCCodes(['01 01 01'], 101010)).toEqual(['01 01 01', '101010'])
    expect(parseEWCCodes(null, ';01 01 01;;010101;')).toEqual(['010101', '010101'])
    expect(parseEWCCodes(['01 01 01'], ';101010')).toEqual(['01 01 01', '101010'])
    expect(() =>
      parseEWCCodes(null, {
        toString: () => {
          throw new Error('error')
        }
      })
    ).toThrow()
  })

  test('parseRegStatements', () => {
    expect(parseRegStatements(null, '123;456')).toEqual([123, 456])
    expect(parseRegStatements([123], '456')).toEqual([123, 456])
    expect(() =>
      parseRegStatements(null, {
        toString: () => {
          throw new Error('error')
        }
      })
    ).toThrow()
  })

  test('parseEstimate', () => {
    expect(parseEstimate(null, String('est'))).toEqual(true)
    expect(parseEstimate(null, 'act')).toEqual(false)
    expect(() => parseEstimate(null, null)).toThrow()
  })

  test('parseBoolean', () => {
    expect(parseBoolean(null, String('true'))).toEqual(true)
    expect(parseBoolean(null, false)).toEqual(false)
    expect(parseBoolean(null, { formula: 'FALSE()' })).toEqual(false)
    expect(() => parseBoolean(null, null)).toThrow()
  })

  test('parseDisposalCodes', () => {
    expect(parseDisposalCodes(null, 'D09 = 10,000 = kg = Estimate')).toEqual([
      {
        code: 'D9',
        weight: {
          amount: 10000,
          isEstimate: true,
          metric: 'Kilograms'
        }
      }
    ])
    expect(parseDisposalCodes(null, 'D90 = 10,000 = fish = Actual')).toEqual([
      {
        code: 'D90',
        weight: {
          amount: 10000,
          isEstimate: false,
          metric: 'fish'
        }
      }
    ])
    expect(parseDisposalCodes(null, 'R01 = 0.95 = Tonnes = Est')).toEqual([
      {
        code: 'R1',
        weight: {
          amount: 0.95,
          isEstimate: true,
          metric: 'Tonnes'
        }
      }
    ])
    expect(parseDisposalCodes(null, 'R01 = 10,000.95 = Tonnes = Est')).toEqual([
      {
        code: 'R1',
        weight: {
          amount: 10000.95,
          isEstimate: true,
          metric: 'Tonnes'
        }
      }
    ])
    expect(parseDisposalCodes(null, 'R01 = 10,000.95 = Tonnes = Est; R02 = 10,000.95 = Tonnes = Est')).toEqual([
      {
        code: 'R1',
        weight: {
          amount: 10000.95,
          isEstimate: true,
          metric: 'Tonnes'
        }
      },
      {
        code: 'R2',
        weight: {
          amount: 10000.95,
          isEstimate: true,
          metric: 'Tonnes'
        }
      }
    ])
    expect(parseDisposalCodes(null, 'R01 = fish = Tonnes = Est')).toEqual([
      {
        code: 'R1',
        weight: {
          amount: 'fish',
          isEstimate: true,
          metric: 'Tonnes'
        }
      }
    ])
  })

  test('parseDisposalCodes with defaults', () => {
    expect(parseDisposalCodes(null, 'R_ 01')).toEqual([
      {
        code: 'R1',
        weight: 'whole item'
      }
    ])
    expect(() => parseDisposalCodes(null, 'R01; R02')).toThrow(/Cannot parse disposal.*/)
    expect(
      populateWholeItemDisposalCodes({
        yourUniqueReference: 'REF1',
        wasteItems: [
          {
            weight: { amount: 100, isEstimate: true, metric: 'Tonnes' },
            disposalOrRecoveryCodes: [{ code: 'R1', weight: 'whole item' }]
          }
        ]
      })
    ).toEqual({
      yourUniqueReference: 'REF1',
      wasteItems: [
        {
          weight: { amount: 100, isEstimate: true, metric: 'Tonnes' },
          disposalOrRecoveryCodes: [{ code: 'R1', weight: { amount: 100, isEstimate: true, metric: 'Tonnes' } }]
        }
      ]
    })

    expect(
      populateWholeItemDisposalCodes({
        yourUniqueReference: 'REF1',
        wasteItems: [
          {
            weight: { amount: 100, isEstimate: true, metric: 'Tonnes' },
            disposalOrRecoveryCodes: [{ code: 'R1', weight: {} }]
          }
        ]
      })
    ).toEqual({
      yourUniqueReference: 'REF1',
      wasteItems: [
        {
          weight: { amount: 100, isEstimate: true, metric: 'Tonnes' },
          disposalOrRecoveryCodes: [{ code: 'R1', weight: {} }]
        }
      ]
    })

    expect(
      populateWholeItemDisposalCodes({
        yourUniqueReference: 'REF1',
        wasteItems: [
          {
            weight: { amount: 100, isEstimate: true, metric: 'Tonnes' },
            disposalOrRecoveryCodes: [
              { code: 'R1', weight: 'whole item' },
              { code: 'R1', weight: 'whole item' }
            ]
          }
        ]
      })
    ).toEqual({
      yourUniqueReference: 'REF1',
      wasteItems: [
        {
          weight: { amount: 100, isEstimate: true, metric: 'Tonnes' },
          disposalOrRecoveryCodes: [
            { code: 'R1', weight: 'whole item' },
            { code: 'R1', weight: 'whole item' }
          ]
        }
      ]
    })
  })

  test('parseComponentCodes', () => {
    expect(parseComponentCodes(null, 'Hydrochloric Acid = 37; Water = 9963')).toEqual([
      {
        code: 'Hydrochloric Acid',
        concentration: 37
      },
      {
        code: 'Water',
        concentration: 9963
      }
    ])
    expect(parseComponentCodes(null, 'Mercury=0.35;Arsenic=300;Chromium=0.42;')).toEqual([
      { code: 'Mercury', concentration: 0.35 },
      { code: 'Arsenic', concentration: 300 },
      { code: 'Chromium', concentration: 0.42 }
    ])
    expect(() => parseComponentCodes(null, 'ontehu')).toThrow()
  })

  test('parseHazCodes', () => {
    expect(parseHazCodes(null, 'HP0120')).toEqual(['HP_120'])
    expect(() => parseHazCodes(null, null)).toThrow()
  })

  test('parseContainerType', () => {
    expect(parseContainerType(null, '[ABC] fish')).toEqual('ABC')
    expect(parseContainerType('ABC', null)).toEqual('ABC')
  })

  test('parseTitleCase', () => {
    expect(parseTitleCase(null, 'road')).toEqual('Road')
    expect(parseTitleCase(null, 'ROAD')).toEqual('Road')
    expect(parseTitleCase(null, '  road  ')).toEqual('Road')
    expect(parseTitleCase(null, 'inland waterway')).toEqual('Inland Waterway')
    expect(parseTitleCase(null, 'INLAND WATERWAY')).toEqual('Inland Waterway')
    expect(parseTitleCase(null, 'kilograms')).toEqual('Kilograms')
    expect(parseTitleCase(null, 'TONNES')).toEqual('Tonnes')
    expect(parseTitleCase(null, 'liquid')).toEqual('Liquid')
    expect(parseTitleCase(null, 'SOLID')).toEqual('Solid')
    expect(parseTitleCase(null, 123)).toEqual('123')
    expect(parseTitleCase('existing', null)).toEqual('existing')
    expect(parseTitleCase('existing', '   ')).toEqual('existing')
    expect(parseTitleCase('existing', '')).toEqual('existing')
  })

  test('parseToString', () => {
    expect(parseToString(null, 123)).toEqual('123')
    expect(parseToString('ABC', null)).toEqual('ABC')
    expect(parseToString(null, ' ABC ')).toEqual('ABC')
  })

  test('parseComponentNames', () => {
    expect(parseComponentNames(null, 'abc=123;def=7.1;')).toEqual([
      { concentration: 123, name: 'abc' },
      { concentration: 7.1, name: 'def' }
    ])
    expect(parseComponentNames(null, 'abc=123')).toEqual([{ concentration: 123, name: 'abc' }])
    expect(() => parseComponentNames(null, 'abc')).toThrow()
  })

  test('validateMovementHasWasteItems', () => {
    expect(() => validateMovementHasWasteItems({ yourUniqueReference: 'fish' })).toThrow()
    expect(() => validateMovementHasWasteItems({ yourUniqueReference: 'fish', wasteItems: [] })).toThrow()
    expect(validateMovementHasWasteItems({ yourUniqueReference: 'fish', wasteItems: [{}] })).toEqual({ yourUniqueReference: 'fish', wasteItems: [{}] })
  })
})

describe('coerceRegistrationNumberWhenReasonSupplied', () => {
  test('ads blank string', () => {
    const m = { carrier: { reasonForNoRegistrationNumber: 'something' } }
    expect(coerceRegistrationNumberWhenReasonSupplied(m)).toEqual({ carrier: { reasonForNoRegistrationNumber: 'something', registrationNumber: '' } })
  })
})

describe('validateWasteTrackingIds', () => {
  test('returns errors when wasteTrackingId is missing', () => {
    expect(() => validateWasteTrackingIdExists({ yourUniqueReference: 'REF2' })).toThrow('Waste Tracking ID is required')
  })

  test('returns movement when all wasteTrackingIds are present', () => {
    const m = { yourUniqueReference: 'REF1', wasteTrackingId: 'WTID123' }
    expect(validateWasteTrackingIdExists(m)).toEqual(m)
  })
})

describe('validateNoWasteTrackingIds', () => {
  test('returns errors when wasteTrackingId is present', () => {
    expect(() => validateWasteTrackingIdMissing({ yourUniqueReference: 'REF2', wasteTrackingId: 'WTID123' })).toThrow(
      'Waste Tracking ID must not be present on a create upload'
    )
  })

  test('returns empty array when no wasteTrackingIds are present', () => {
    const m = { yourUniqueReference: 'REF1' }
    expect(validateWasteTrackingIdMissing(m)).toEqual(m)
  })
})

describe('some excel unit tests', () => {
  test.each([
    ['test', 'test'],
    [{ richText: [{ text: 'test' }] }, 'test'],
    [{ richText: [{ font: { name: 'Calibri' }, text: 'R1 = 0.75 = Tonnes = Estimate' }] }, 'R1 = 0.75 = Tonnes = Estimate'],
    [123, 123],
    [0, 0],
    [true, true],
    [false, false],
    [null, ''],
    [undefined, ''],
    ['', ''],
    [{ richText: [{ text: 'a' }, { text: 'b' }] }, 'ab'],
    [{ richText: [{ text: '' }] }, ''],
    [{ richText: [{ a: 'a' }, { a: 'b' }] }, '[object Object][object Object]']
  ])('getting cell value text: %s -> %s', (val, text) => {
    const result = cellValueText(val)
    expect(result).toEqual(text)
  })

  test.each([[null], [undefined]])('cellValueText(%s) never returns null or undefined', (val) => {
    expect(cellValueText(val)).toBeDefined()
    expect(cellValueText(val)).not.toBeNull()
  })

  test.each([
    [{}, 'test', { richText: [{ text: 'test' }] }],
    [{ value: { richText: [{ text: 'test' }] } }, 'test', { richText: [{ text: 'test' }, { text: '\ntest' }] }],
    [{}, 'test', { richText: [{ text: 'test', font: { name: 'Comic Sans' } }] }, { name: 'Comic Sans' }]
  ])('should update cell text', (cell, message, result, font) => {
    expect(appendMessageToCell(cell, message, font)).toEqual(result)
  })
})

describe('transformBulkApiErrors', () => {
  const worksheetMetadata = { firstRowOfDataInSpreadsheet: 9, movementWorksheetName: '7. Waste movement level', itemWorksheetName: '8. Waste item level' }

  test('distinct should deduplicate identical errors for the same cell', () => {
    const movementData = [{ yourUniqueReference: 'REF1', carrier: { organisationName: 'Carrier Ltd' } }]
    const rowNumbers = { REF1: { movementRow: 9 } }
    const duplicateError = { key: '0.carrier.organisationName', message: '"0.carrier.organisationName" is required' }

    const result = transformBulkApiErrors(movementData, rowNumbers, worksheetMetadata, [duplicateError, duplicateError])
    const errors = result['7. Waste movement level']
    expect(errors).toHaveLength(1)
  })

  test('should add default error message when col not matched', () => {
    const movementData = [{ yourUniqueReference: 'REF1', carrier: { organisationName: 'Carrier Ltd' } }]
    const rowNumbers = { REF1: { movementRow: 9 } }
    const apiErrors = [
      {
        key: '0.submittingOrganisation',
        errorType: 'BusinessRuleViolation',
        message: '[0].submittingOrganisation the submitting organisation does not match the Organisation that created the original waste item record'
      }
    ]

    const result = transformBulkApiErrors(movementData, rowNumbers, worksheetMetadata, apiErrors)
    expect(result).toEqual({
      '7. Waste movement level': [
        {
          coords: [3, 9],
          message: '[0].submittingOrganisation the submitting organisation does not match the Organisation that created the original waste item record',
          sheet: '7. Waste movement level'
        }
      ]
    })
  })

  test('should partially match error key', () => {
    const movementData = [
      {
        yourUniqueReference: 'REF1',
        carrier: {
          organisationName: 'Carrier Ltd',
          wasteItems: [
            {
              pops: {
                components: [
                  {
                    code: 'ALD',
                    concentration: 50
                  }
                ]
              }
            }
          ]
        }
      }
    ]
    const rowNumbers = { REF1: { movementRow: 9, itemRows: [9] } }
    const apiError = [
      {
        key: '0.wasteItems.0.pops',
        errorType: 'UnexpectedError',
        message: '"wasteItems[wasteItems].pops.sourceOfComponents" is required when containsPops is true'
      }
    ]

    const result = transformBulkApiErrors(movementData, rowNumbers, worksheetMetadata, apiError)
    expect(result).toEqual({
      '8. Waste item level': [
        {
          coords: [12, 9],
          message: 'pops is required when containsPops is true',
          sheet: '8. Waste item level'
        }
      ]
    })
  })
})

describe('excel proccessor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockWorksheet = (fakeData, rowPadding = 8) => {
    const fakeRows = Array.apply(null, Array(rowPadding))
      .map(() => [])
      .concat(fakeData)
    return {
      eachRow: (rowCallback) => {
        fakeRows.forEach((r, i) => {
          const row = {
            getCell: (col) => {
              return { value: r[col - 1] }
            },
            eachCell: (cellCallback) => {
              r.forEach((c, j) => {
                cellCallback({ value: c }, j + 1)
              })
            }
          }
          rowCallback(row, i + 1)
        })
      },
      getRow: (rowNumber) => ({
        getCell: (colNumber) => {
          const row = fakeRows[rowNumber]
          const text = colNumber < row?.length ? row[colNumber] : ''
          return {
            value: { richText: [{ text }] }
          }
        }
      })
    }
  }

  const mockWorkbook = (buffer, movementData, itemData) => {
    vi.spyOn(excelImportModule, 'readExcelBuffer').mockResolvedValue({
      xlsx: { writeBuffer: async () => buffer, writeFile: async () => null },
      getWorksheet: (wsName) => {
        const w = {
          bumf: mockWorksheet([[], ['', 'Report receipt of waste', '2', '3']], 0),
          '7. Waste movement level': mockWorksheet(movementData),
          '8. Waste item level': mockWorksheet(itemData)
        }
        return w[wsName]
      },
      worksheets: [{ name: 'bumf' }, { name: '7. Waste movement level' }, { name: '8. Waste item level' }]
    })
  }

  test('should reject not excel files', async () => {
    const { hasErrors, workbook } = await parseExcelFile(Buffer.from('fish'), 'org-id', logger)
    expect(hasErrors).toEqual(true)
    expect(workbook).toEqual(undefined)
  })

  test('should parse buffer with timezone shifting', { timeout: 100000 }, async () => {
    const oldTimezone = process.env.TZ
    process.env.TZ = 'Europe/London'
    const buffer = await fs.readFile('./test-resources/example-spreadsheet.xlsx')
    const transformedMovements = []
    const { movements, errors } = await parseExcelFile(buffer, 'org-id', logger, (m) => {
      transformedMovements.push(m)
      return m
    })
    expect(errors).toEqual({
      '7. Waste movement level': [],
      '8. Waste item level': [
        {
          coords: [2, 10],
          message: 'No waste movements for unique reference'
        },
        {
          coords: [2, 11],
          message: 'No waste movements for unique reference'
        }
      ]
    })
    expect(movements).toEqual(transformedMovements)
    expect(movements).toEqual([
      {
        submittingOrganisation: {
          defraCustomerOrganisationId: 'org-id'
        },
        carrier: {
          organisationName: 'Qualitech Environmental Services Ltd',
          registrationNumber: '',
          reasonForNoRegistrationNumber: 'ON_SITE'
        },
        dateTimeReceived: new Date('2026-05-14T11:15:05.000Z'),
        hazardousWasteConsignmentCode: 'KAWASA/19963',
        receipt: {
          address: {
            fullAddress: 'Ernesettle Lane, Plumouth',
            postcode: 'PL5 2SA'
          }
        },
        receiver: {
          authorisationNumber: 'abc123',
          siteName: 'Kawasaki Precision Machinery UK Ltd'
        },
        yourUniqueReference: 'KAWASA/19963',
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
            ewcCodes: ['060110'],
            hazardous: {
              components: [
                {
                  name: 'Hydrochloric Acid',
                  concentration: '<=37%'
                },
                {
                  name: 'Water',
                  concentration: 'Balance'
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
          }
        ]
      }
    ])
    process.env.TZ = oldTimezone
  })

  test('should write waste tracking ids', { timeout: 50000 }, async () => {
    const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
    const { workbook, movements, rowNumbers, worksheetMetadata } = await parseExcelFile(buffer, 'org-id', logger)
    const bulkImportResult = { movements: [{ wasteTrackingId: '26WR8B1H' }] }

    const coords = wasteTrackingIdsToCoords(movements, rowNumbers, bulkImportResult.movements, worksheetMetadata)
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
    await workbook.xlsx.writeFile('./test-resources/output-spreadsheet-with-waste-tracking-ids.xlsx')
  })

  test('updateCellContent handles null and undefined values', { timeout: 50000 }, async () => {
    const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
    const { workbook } = await parseExcelFile(buffer, 'org-id', logger)
    const worksheetName = '7. Waste movement level'

    updateCellContent(workbook, {
      [worksheetName]: [
        { coords: [2, 9], value: null },
        { coords: [2, 10], value: undefined }
      ]
    })

    const worksheet = workbook.getWorksheet(worksheetName)
    const cell1 = worksheet.getRow(9).getCell(2)
    const cell2 = worksheet.getRow(10).getCell(2)
    expect(cell1.value.richText[0].text).toBe('')
    expect(cell2.value.richText[0].text).toBe('')
  })

  test('should write errors buffer', { timeout: 100000 }, async () => {
    const buffer = Buffer.from('test xl file')
    mockWorkbook(
      buffer,
      [['', 'waste tracking id', 'REF1', '']],
      [
        ['', 'REF1', '', ''],
        ['', 'REF2', '', '']
      ]
    )
    const mockUpdateErrors = vi.spyOn(excelImportModule, 'updateErrors').mockImplementation((workbook, _errors) => workbook)
    const mockTransform = vi.fn().mockImplementation(() => {
      const e = Error('test error')
      e.colNumber = 33
      throw e
    })

    const { hasErrors } = await parseExcelFile(buffer, 'org-id', logger, mockTransform)

    expect(hasErrors).toEqual(true)
    expect(mockTransform).toHaveBeenCalled()
    expect(mockUpdateErrors).toHaveBeenCalledWith(expect.anything(), {
      '7. Waste movement level': [{ coords: [33, 9], message: 'test error' }],
      '8. Waste item level': [{ coords: [2, 10], message: 'No waste movements for unique reference' }]
    })
  })

  test('should validate that the "yourUniqueReference" field is provided', { timeout: 50000 }, async () => {
    const buffer = Buffer.from('test xl file')
    mockWorkbook(
      buffer,
      [['', '', '', 'company name', '', '', '']],
      [
        ['', '', 'ewc code 1', ''],
        ['', null, 'ewc code 2', '']
      ]
    )
    const mockUpdateErrors = vi.spyOn(excelImportModule, 'updateErrors').mockImplementation((workbook, _errors) => workbook)
    const { hasErrors } = await parseExcelFile(buffer, 'org-id', logger, validateWasteTrackingIdMissing)
    expect(hasErrors).toEqual(true)
    expect(mockUpdateErrors).toHaveBeenCalledWith(expect.anything(), {
      '7. Waste movement level': [{ coords: [3, 9], message: 'Please provide a value' }],
      '8. Waste item level': [
        { coords: [2, 9], message: 'Please provide a value' },
        { coords: [2, 10], message: 'Please provide a value' }
      ]
    })
  })

  test("should validate that yourUniqueReference's are provided for waste movements", async () => {
    const buffer = Buffer.from('test xl file')
    mockWorkbook(
      buffer,
      [
        [
          '',
          '',
          '',
          'Spectrum Control',
          'Fetherstone Lane',
          'MK12 5EW',
          'ZP3537SL',
          '',
          'info@roberthopkins.co.uk',
          '0121 553 0403',
          '13/01/2026',
          'SPECTR/66032',
          '',
          '',
          'CBDU80960',
          '',
          'Robert Hopkins Environmental Services ltd',
          '',
          '',
          '',
          '',
          'Road',
          'R13 ENV'
        ],
        [
          '',
          '',
          '',
          'Spectrum Control',
          'Fetherstone Lane',
          'MK12 5EW',
          'ZP3537SL',
          '',
          'info@roberthopkins.co.uk',
          '0121 553 0403',
          '13/01/2026',
          'SPECTR/66032',
          '',
          '',
          'CBDU80960',
          '',
          'Robert Hopkins Environmental Services ltd',
          '',
          '',
          '',
          '',
          'Road',
          'R13 ENV'
        ]
      ],
      [
        [
          '',
          '',
          '200135',
          'WEEE WASTE',
          'Solid',
          '1',
          'IBC',
          'Kilograms',
          '1000',
          'Yes',
          'No',
          '',
          'PROVIDED_WITH_WASTE',
          'Yes',
          'HP14',
          '',
          'PROVIDED_WITH_WASTE',
          'R13;R14'
        ],
        [
          '',
          '',
          '191201',
          'Paper',
          'Solid',
          '1',
          'IBC',
          'Kilograms',
          '1000',
          'Yes',
          'No',
          '',
          'PROVIDED_WITH_WASTE',
          'No',
          'N/H',
          '',
          'PROVIDED_WITH_WASTE',
          'D15'
        ]
      ]
    )
    const mockUpdateErrors = vi.spyOn(excelImportModule, 'updateErrors').mockImplementation((workbook, _errors) => workbook)
    const { hasErrors } = await parseExcelFile(buffer, 'org-id', logger, validateWasteTrackingIdMissing)
    expect(hasErrors).toEqual(true)
    expect(mockUpdateErrors).toHaveBeenCalledWith(
      expect.anything(),
      {
        '7. Waste movement level': [
          {
            coords: [3, 9],
            message: 'Please provide a value'
          },
          {
            coords: [3, 10],
            message: 'Please provide a value'
          }
        ],
        '8. Waste item level': [
          {
            coords: [2, 9],
            message: 'Please provide a value'
          },
          {
            coords: [18, 9],
            errorValue: 'R13;R14',
            message: 'Cannot parse disposal / recovery codes (R13)'
          },
          {
            coords: [2, 10],
            message: 'Please provide a value'
          }
        ]
      },
      expect.anything()
    )
  })

  test("should validate that yourUniqueReference's are unique for waste movements", async () => {
    const buffer = Buffer.from('test xl file')
    mockWorkbook(
      buffer,
      [
        [
          '',
          '',
          'test1',
          'Spectrum Control',
          'Fetherstone Lane',
          'MK12 5EW',
          'ZP3537SL',
          '',
          'info@roberthopkins.co.uk',
          '0121 553 0403',
          '13/01/2026',
          'SPECTR/66032',
          '',
          '',
          'CBDU80960',
          '',
          'Robert Hopkins Environmental Services ltd',
          '',
          '',
          '',
          '',
          'Road',
          'R13 ENV'
        ],
        [
          '',
          '',
          'test1',
          'Spectrum Control',
          'Fetherstone Lane',
          'MK12 5EW',
          'ZP3537SL',
          '',
          'info@roberthopkins.co.uk',
          '0121 553 0403',
          '13/01/2026',
          'SPECTR/66032',
          '',
          '',
          'CBDU80960',
          '',
          'Robert Hopkins Environmental Services ltd',
          '',
          '',
          '',
          '',
          'Road',
          'R13 ENV'
        ]
      ],
      [
        [
          '',
          'test1',
          '200135',
          'WEEE WASTE',
          'Solid',
          '1',
          'IBC',
          'Kilograms',
          '1000',
          'Yes',
          'No',
          '',
          'PROVIDED_WITH_WASTE',
          'Yes',
          'HP14',
          '',
          'PROVIDED_WITH_WASTE',
          'R13'
        ],
        [
          '',
          'test1',
          '191201',
          'Paper',
          'Solid',
          '1',
          'IBC',
          'Kilograms',
          '1000',
          'Yes',
          'No',
          '',
          'PROVIDED_WITH_WASTE',
          'No',
          'N/H',
          '',
          'PROVIDED_WITH_WASTE',
          'D15qqq'
        ]
      ]
    )
    const mockUpdateErrors = vi.spyOn(excelImportModule, 'updateErrors').mockImplementation((workbook, _errors) => workbook)
    const { hasErrors } = await parseExcelFile(buffer, 'org-id', logger, validateWasteTrackingIdMissing)
    expect(hasErrors).toEqual(true)
    expect(mockUpdateErrors).toHaveBeenCalledWith(
      expect.anything(),
      {
        '7. Waste movement level': [
          {
            coords: [3, 10],
            message: 'Duplicate reference'
          },
          {
            coords: [3, 10],
            message: 'No waste items for unique reference'
          }
        ],
        '8. Waste item level': [
          {
            coords: [18, 10],
            errorValue: 'D15qqq',
            message: 'Cannot parse disposal / recovery codes (D15qqq)'
          }
        ]
      },
      expect.anything()
    )
  })

  test('should have errors when worksheets are missing', { timeout: 100000 }, async () => {
    const buffer = Buffer.from('test xl file')
    const movementData = [['', 'waste tracking id', 'REF1', '']]
    const itemData = [
      ['', 'REF1', '', ''],
      ['', 'REF2', '', '']
    ]
    vi.spyOn(excelImportModule, 'readExcelBuffer').mockResolvedValue({
      xlsx: { writeBuffer: async () => buffer, writeFile: async () => null },
      worksheets: [{ name: 'bumf' }, { name: 'renamed - Waste movement level' }, { name: 'renamed - Waste item level' }],
      getWorksheet: (wsName) => {
        const w = {
          bumf: mockWorksheet([['', 'Report receipt of waste']], 1),
          'renamed - Waste movement level': mockWorksheet(movementData),
          'renamed - Waste item level': mockWorksheet(itemData)
        }
        return w[wsName]
      }
    })

    const mockUpdateErrors = vi.spyOn(excelImportModule, 'updateErrors').mockImplementation((workbook, _errors) => workbook)
    const mockTransform = vi.fn().mockImplementation(() => {
      const e = Error('test error')
      e.colNumber = 33
      throw e
    })

    const { hasErrors } = await parseExcelFile(buffer, 'org-id', logger, mockTransform)
    expect(hasErrors).toEqual(true)
    expect(mockTransform).not.toHaveBeenCalled()
    expect(mockUpdateErrors).not.toHaveBeenCalled()
  })

  test('should have errors when there is no data', { timeout: 100000 }, async () => {
    const buffer = Buffer.from('test xl file')
    mockWorkbook(buffer, [], [])

    const mockUpdateErrors = vi.spyOn(excelImportModule, 'updateErrors').mockImplementation((workbook, _errors) => workbook)

    const { hasErrors } = await parseExcelFile(buffer, 'org-id', logger)
    expect(hasErrors).toEqual(true)
    expect(mockUpdateErrors).toHaveBeenCalledWith(
      expect.anything(),
      {
        '7. Waste movement level': [
          {
            coords: [3, 9],
            message: 'No movements recognised',
            sheet: '7. Waste movement level'
          }
        ],
        '8. Waste item level': []
      },
      expect.anything()
    )
  })
})

import fs from 'node:fs/promises'
import { parseExcelFile } from './spreadsheetImport.js'

describe('excel proccessor', () => {
  test('should parse buffer', { timeout: 100000 }, async () => {
    const buffer = await fs.readFile('./test-resources/example-spreadsheet.xlsx')
    const { movements, errors } = await parseExcelFile(buffer)
    expect(movements[0].dateTimeReceived).toEqual(new Date('2026-01-14T11:05:00.000Z'))
    expect(movements).toEqual([
      {
        carrier: {
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
          siteName: 'Kawasaki Precision Machinery UK Ltd'
        },
        yourUniqueReference: 'KAWASA/19963',
        wasteItems: [
          {
            containsHazardous: true,
            containsPops: false,
            disposalOrRecoveryCodes: {
              code: 'D09',
              weight: {
                amount: 'kg',
                isEstimate: 'estimate',
                metric: '10,000'
              }
            },
            ewcCodes: '06 01 10',
            hazardous: {
              components: [
                {
                  code: 'Hydrochloric Acid',
                  concentration: '<=37%'
                },
                {
                  code: 'Water',
                  concentration: 'Balance'
                }
              ],
              hazCodes: 'HP5, HP8',
              sourceOfComponents: 'PROVIDED_WITH_WASTE'
            },
            numberOfContainers: 1,
            physicalForm: 'Liquid',
            typeOfContainers: '[TAN] Tanker/Tank',
            wasteDescription: 'Hydrochloric Pickling Acid',
            weight: {
              amount: 10000,
              isEstimate: true,
              metric: 'Kilograms'
            },
            yourUniqueReference: 'KAWASA/19963'
          }
        ]
      }
    ])
    expect(errors).toEqual({
      items: [
        {
          coords: [2, 10],
          message: 'No waste movements for unique reference'
        },
        {
          coords: [2, 11],
          message: 'No waste movements for unique reference'
        }
      ],
      movements: []
    })
  })

  test('should write errors buffer', { timeout: 100000 }, async () => {
    const buffer = await fs.readFile('./test-resources/example-spreadsheet-2.xlsx')
    const { errors, workbook } = await parseExcelFile(buffer)
    expect(errors).toEqual({
      '7. Waste movement level': [
        {
          coords: [12, 9],
          message: 'Cannot parse time'
        }
      ],
      '8. Waste item level': [
        {
          coords: [18, 9],
          message: 'Cannot parse disposal codes.'
        },
        {
          coords: [12, 10],
          message: 'Cannot parse component codes'
        },
        {
          coords: [16, 10],
          message: 'Cannot parse component names'
        },
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
    await workbook.xlsx.writeFile('./test-resources/output-spreadsheet-2-with-errors.xlsx')
  })
})

/*
const example = {
  apiCode: 'ba6eb330-4f7f-11eb-a2fb-67c34e9ac07cg',
  dateTimeReceived:
    'UTC - 2025-09-15T12:12:28Z, BST - 2025-09-15T13:12:28+01:00',
  hazardousWasteConsignmentCode:
    'Company name: CJTILE Ltd → Code prefix: CJTILE/\nUnique ID: A0001\nFull code: CJTILE/A0001\n',
  reasonForNoConsignmentCode: 'Carrier did not provide documentation',
  yourUniqueReference: 'wTBrdgAA020',
  otherReferencesForMovement: [
    {
      label: 'PO Number',
      reference: 'PO-12345'
    },
    {
      label: 'Waste Ticket',
      reference: 'WT-67890'
    },
    {
      label: 'Haulier Note',
      reference: 'HN-11111'
    }
  ],
  specialHandlingRequirements:
    'The waste must be fully inspected by the waste handler according to the Hazardous waste consignment and or EWC codes provided.',
  wasteItems: [
    {
      ewcCodes:
        '200108 biodegradable kitchen and canteen waste, 150109 textile packaging',
      wasteDescription:
        'Basic mixed construction and demolition waste, this includes recyclable house bricks, gypsum plaster and slates.',
      physicalForm: 'Sludge',
      numberOfContainers: '2, 3',
      typeOfContainers: 'BAG, PAL, SKI',
      weight: {
        metric: 'Tonnes',
        amount: 150,
        isEstimate: true
      },
      containsPops: true,
      pops: {
        sourceOfComponents: 'PROVIDED_WITH_WASTE',
        components: [
          {
            code: 'PFHXS, HBB, END, PCDD_PCDF',
            concentration: '12.5, 9,21234, 500'
          }
        ]
      },
      containsHazardous: true,
      hazardous: {
        sourceOfComponents: 'PROVIDED_WITH_WASTE',
        hazCodes:
          'HP 5 - Wastes from petroleum refining, Natural Gas Purification and pyrolitic treatment of coal, HP 10 - Wastes from Thermal Processes</p>',
        components: [
          {
            name: 'lead, mercury',
            concentration: '50, 12.5, 25.5'
          }
        ]
      },
      disposalOrRecoveryCodes: [
        {
          code: '"R1"\n',
          weight: {
            metric: 'Tonnes',
            amount: 150,
            isEstimate: true
          }
        }
      ]
    }
  ],
  carrier: {
    registrationNumber:
      'England - CBDL6, CBDU45, CBDU84916, Wales - CBDL1, CBDU33, CBDU84916, Scotland - WCR/522048, Northern Ireland - ROC UT 36, ROC LT 5432',
    reasonForNoRegistrationNumber:
      'Waste carrier did not provide a carrier registration number.',
    organisationName: 'Waste Carriers Lite Ltd',
    address: {
      fullAddress: '26a Oil Drum Lane, London, UK',
      postcode: 'W12 7ZL'
    },
    emailAddress: 'info@wastecarrierselite.co.uk',
    phoneNumber: '020 4756 XXXX',
    vehicleRegistration: 'RNT 493',
    meansOfTransport: 'Rail'
  },
  brokerOrDealer: {
    organisationName: 'Waste Desposal Ltd',
    address: {
      fullAddress: '26a Oil Drum Lane, London, UK',
      postcode: 'W12 7ZL'
    },
    emailAddress: 'info@wastecarrierselite.co.uk',
    phoneNumber: '020 4756 XXXX',
    registrationNumber:
      'CBDL6, CBDU45, CBDU84916, Wales - CBDL1, CBDU33, Scotland - WCR/R/522048, Northern Ireland - ROC UT 36, ROC LT 5432'
  },
  receiver: {
    siteName: 'string',
    emailAddress: 'info@wastecarrierselite.co.uk',
    phoneNumber: '020 4756 XXXX',
    authorisationNumber: 'HP3456XX',
    regulatoryPositionStatements: [343, 456, 789]
  },
  receipt: {
    address: {
      fullAddress: '26a Oil Drum Lane, London, UK',
      postcode: 'W12 7ZL'
    }
  }
}
*/

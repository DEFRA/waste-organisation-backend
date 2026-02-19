import fs from 'node:fs/promises'
import { parseExcelFile } from './spreadsheetImport.js'

describe('excel proccessor', () => {
  test('should parse buffer', { timeout: 100000 }, async () => {
    const buffer = await fs.readFile('./test-resources/example-spreadsheet.xlsx')
    const { movements, errors } = await parseExcelFile(buffer)
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
    expect(movements).toEqual([
      {
        submittingOrganisation: {
          defraCustomerOrganisationId: undefined
        },
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
  })

  test('should write errors buffer', { timeout: 100000 }, async () => {
    const buffer = await fs.readFile('./test-resources/example-spreadsheet-2.xlsx')
    const { errors, outputErrorWorkbook } = await parseExcelFile(buffer)
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
          message: 'Cannot parse disposal / recovery codes (oneuthoenuth)'
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
    // await outputErrorWorkbook.xlsx.writeFile('./test-resources/output-spreadsheet-2-with-errors.xlsx')
  })
})

/*

[
  {
    "submittingOrganisation": {
      "defraCustomerOrganisationId": "537b0d7a-30d6-4fe5-a463-bcfb2d1bc4c6"
    },
    "dateTimeReceived": "2026-02-12T09:57:18.355Z",
    "wasteItems": [
      {
        "ewcCodes": [
          "020101"
        ],
        "wasteDescription": "Basic mixed construction and demolition waste",
        "physicalForm": "Mixed",
        "numberOfContainers": 3,
        "typeOfContainers": "SKI",
        "weight": {
          "metric": "Tonnes",
          "amount": 2.5,
          "isEstimate": false
        },
        "containsHazardous": false,
        "containsPops": false,
        "disposalOrRecoveryCodes": [
          {
            "code": "R1",
            "weight": {
              "metric": "Tonnes",
              "amount": 0.75,
              "isEstimate": false
            }
          }
        ]
      }
    ],
    "carrier": {
      "organisationName": "Carrier Ltd",
      "registrationNumber": "CBDL999999",
      "meansOfTransport": "Rail"
    },
    "receiver": {
      "siteName": "Receiver Ltd",
      "emailAddress": "receiver@test.com",
      "authorisationNumber": "PPC/A/9999999"
    },
    "receipt": {
      "address": {
        "fullAddress": "123 Test Street, Test City",
        "postcode": "TC1 2AB"
      }
    }
  }
]




  
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

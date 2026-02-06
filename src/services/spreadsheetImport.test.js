import fs from 'node:fs/promises'
import { parseExcelFile, dataToRequest } from './spreadsheetImport.js'

describe('excel proccessor', () => {
  test('should parse buffer', { timeout: 10000 }, async () => {
    const buffer = await fs.readFile(
      './test-resources/example-spreadsheet.xlsx'
    )
    const data = await parseExcelFile(buffer)
    expect(data).toEqual(dataFromSpreadsheet)
  })

  // test('should format as api request structure', () => {
  //   const data = dataToRequest(dataFromSpreadsheet)
  //   expect(data).toEqual([])
  // })
})

const dataFromSpreadsheet = {
  items: [
    {
      containsHazardous: {
        coords: [14, 9],
        value: true
      },
      containsPops: {
        coords: [11, 9],
        value: false
      },
      disposalOrRecoveryCodes: {
        coords: [18, 9],
        value: 'D09 = 10,000 = kg = Estimate'
      },
      ewcCodes: {
        coords: [3, 9],
        value: '06 01 10'
      },
      'hazardous,components,toBeParsed': {
        coords: [16, 9],
        value: 'Hydrochloric Acid = <=37%; Water = Balance'
      },
      'hazardous,hazCodes': {
        coords: [15, 9],
        value: 'HP5, HP8'
      },
      'hazardous,sourceOfComponents': {
        coords: [17, 9],
        value: 'PROVIDED_WITH_WASTE'
      },
      numberOfContainers: {
        coords: [6, 9],
        value: 1
      },
      physicalForm: {
        coords: [5, 9],
        value: 'Liquid'
      },
      typeOfContainers: {
        coords: [7, 9],
        value: '[TAN] Tanker/Tank'
      },
      wasteDescription: {
        coords: [4, 9],
        value: 'Hydrochloric Pickling Acid'
      },
      'weight,amount': {
        coords: [9, 9],
        value: 10000
      },
      'weight,isEstimate': {
        coords: [10, 9],
        value: true
      },
      'weight,metric': {
        coords: [8, 9],
        value: 'Kilograms'
      },
      yourUniqueReference: {
        coords: [2, 9],
        value: 'KAWASA/19963'
      }
    },
    {
      containsHazardous: {
        coords: [14, 10],
        value: 'Yes'
      },
      containsPops: {
        coords: [11, 10],
        value: 'No'
      },
      disposalOrRecoveryCodes: {
        coords: [18, 10],
        value: 'R13 = 2,850 = kg = Estimate'
      },
      ewcCodes: {
        coords: [3, 10],
        value: '15 01 10'
      },
      'hazardous,components,toBeParsed': {
        coords: [16, 10],
        value:
          '2-dibutylaminoethanol (5-<7%) = <1%; Talc (3-<5%) = <1%; Non-hazardous ink components (Balance) = <1%; Metal tins and rags = Balance'
      },
      'hazardous,hazCodes': {
        coords: [15, 10],
        value: 'HP8'
      },
      'hazardous,sourceOfComponents': {
        coords: [17, 10],
        value: 'PROVIDED_WITH_WASTE'
      },
      numberOfContainers: {
        coords: [6, 10],
        value: 19
      },
      physicalForm: {
        coords: [5, 10],
        value: 'Solid'
      },
      typeOfContainers: {
        coords: [7, 10],
        value: '[WBI] Wheelie Bin (any size)'
      },
      wasteDescription: {
        coords: [4, 10],
        value: 'Empty tins and rags c/w ink'
      },
      'weight,amount': {
        coords: [9, 10],
        value: 2850
      },
      'weight,isEstimate': {
        coords: [10, 10],
        value: 'Yes'
      },
      'weight,metric': {
        coords: [8, 10],
        value: 'Kilograms'
      },
      yourUniqueReference: {
        coords: [2, 10],
        value: 'CROWNP/20211'
      }
    },
    {
      containsHazardous: {
        coords: [14, 11],
        value: 'Yes'
      },
      containsPops: {
        coords: [11, 11],
        value: 'No'
      },
      disposalOrRecoveryCodes: {
        coords: [18, 11],
        value: 'R13 = 75 = kg = Estimate'
      },
      ewcCodes: {
        coords: [3, 11],
        value: '14 06 03'
      },
      'hazardous,components,toBeParsed': {
        coords: [16, 11],
        value: 'Acetone = 100%'
      },
      'hazardous,hazCodes': {
        coords: [15, 11],
        value: 'HP3; HP4'
      },
      'hazardous,sourceOfComponents': {
        coords: [17, 11],
        value: 'PROVIDED_WITH_WASTE'
      },
      numberOfContainers: {
        coords: [6, 11],
        value: 3
      },
      physicalForm: {
        coords: [5, 11],
        value: 'Liquid'
      },
      typeOfContainers: {
        coords: [7, 11],
        value: '[DRU] Drum (typically 205L)'
      },
      wasteDescription: {
        coords: [4, 11],
        value: 'Acetone'
      },
      'weight,amount': {
        coords: [9, 11],
        value: 75
      },
      'weight,isEstimate': {
        coords: [10, 11],
        value: 'Yes'
      },
      'weight,metric': {
        coords: [8, 11],
        value: 'Kilograms'
      },
      yourUniqueReference: {
        coords: [2, 11],
        value: 'MCLARE/20185'
      }
    }
  ],
  movements: [
    {
      'carrier,organisationName': {
        coords: [18, 9],
        value: 'Qualitech Environmental Services Ltd'
      },
      'carrier,registrationNumber': {
        coords: [16, 9],
        value: 'CBDU171976'
      },
      'dateTimeReceived,dateReceived': {
        coords: [11, 9],
        value: new Date('2026-01-14T00:00:00.000Z')
      },
      'dateTimeReceived,timeReceived': {
        coords: [12, 9],
        value: new Date('1899-12-30T11:05:00.000Z')
      },
      hazardousWasteConsignmentCode: {
        coords: [13, 9],
        value: 'KAWASA/19963'
      },
      'receipt,address,fullAddress': {
        coords: [5, 9],
        value: 'Ernesettle Lane, Plumouth'
      },
      'receipt,address,postcode': {
        coords: [6, 9],
        value: 'PL5 2SA'
      },
      'receiver,siteName': {
        coords: [4, 9],
        value: 'Kawasaki Precision Machinery UK Ltd'
      },
      yourUniqueReference: {
        coords: [3, 9],
        value: 'KAWASA/19963'
      }
    }
  ]
}

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

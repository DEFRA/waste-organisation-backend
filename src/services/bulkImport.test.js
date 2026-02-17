import fs from 'node:fs/promises'
import { bulkImport } from './bulkImport.js'
import { parseExcelFile } from './spreadsheetImport.js'

describe('bulk import data', () => {
  test('should import some data', { timeout: 50000 }, async () => {
    const conf = {
      endpoint: 'http://localhost:3002',
      url: '/bulk/{{bulkUploadId}}/movements/receive',
      basicAuth: { username: 'waste-organisations-backend', password: '92fa681e-44b4-4b9c-8f7a-59c117757452' }
    }
    const buffer = await fs.readFile('./test-resources/example-spreadsheet.xlsx')
    const { movements } = await parseExcelFile(buffer)

    const res = await bulkImport('abc1234', movements, conf)

    expect(res.errors).toBe([
      {
        errorType: 'UnexpectedError',
        key: '0.wasteItems.0.typeOfContainers',
        message: '"[0].wasteItems[0].typeOfContainers" must be a valid container type'
      },
      {
        errorType: 'UnexpectedError',
        key: '0.wasteItems.0.hazardous.hazCodes.0',
        message:
          '"[0].wasteItems[0].hazardous.hazCodes[0]" must be one of [HP_1, HP_2, HP_3, HP_4, HP_5, HP_6, HP_7, HP_8, HP_9, HP_10, HP_11, HP_12, HP_13, HP_14, HP_15, HP_POP]'
      },
      {
        errorType: 'UnexpectedError',
        key: '0.wasteItems.0.hazardous.hazCodes.1',
        message:
          '"[0].wasteItems[0].hazardous.hazCodes[1]" must be one of [HP_1, HP_2, HP_3, HP_4, HP_5, HP_6, HP_7, HP_8, HP_9, HP_10, HP_11, HP_12, HP_13, HP_14, HP_15, HP_POP]'
      },
      {
        errorType: 'UnexpectedError',
        key: '0.wasteItems.0.hazardous.components.0.name',
        message: '"[0].wasteItems[0].hazardous.components[0].name" is required'
      },
      {
        errorType: 'UnexpectedError',
        key: '0.wasteItems.0.hazardous.components.0.concentration',
        message: '"[0].wasteItems[0].hazardous.components[0].concentration" must be a number'
      },
      {
        errorType: 'UnexpectedError',
        key: '0.wasteItems.0.hazardous.components.0.code',
        message: '"[0].wasteItems[0].hazardous.components[0].code" is not allowed'
      },
      {
        errorType: 'UnexpectedError',
        key: '0.wasteItems.0.hazardous.components.1.name',
        message: '"[0].wasteItems[0].hazardous.components[1].name" is required'
      },
      {
        errorType: 'UnexpectedError',
        key: '0.wasteItems.0.hazardous.components.1.concentration',
        message: '"[0].wasteItems[0].hazardous.components[1].concentration" must be a number'
      },
      {
        errorType: 'UnexpectedError',
        key: '0.wasteItems.0.hazardous.components.1.code',
        message: '"[0].wasteItems[0].hazardous.components[1].code" is not allowed'
      },
      {
        errorType: 'UnexpectedError',
        key: '0.wasteItems.0.disposalOrRecoveryCodes',
        message: '"[0].wasteItems[0].disposalOrRecoveryCodes" must be an array'
      },
      {
        errorType: 'UnexpectedError',
        key: '0.wasteItems.0.yourUniqueReference',
        message: '"[0].wasteItems[0].yourUniqueReference" is not allowed'
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
      },
      {
        errorType: 'NotProvided',
        key: '0',
        message: '"ReceiveMovementRequest" must contain at least one of [apiCode, submittingOrganisation]'
      }
    ])
  })
})

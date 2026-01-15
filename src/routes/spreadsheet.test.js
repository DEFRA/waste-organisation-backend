import {
  initialiseServer,
  WASTE_CLIENT_AUTH_TEST_TOKEN,
  stopServer
} from '../common/helpers/initialse-test-server.js'
import { paths, pathTo } from '../config/paths.js'

describe('spreadsheet API', () => {
  let server

  beforeAll(async () => {
    server = await initialiseServer()
  })

  afterAll(async () => {
    stopServer(server)
  })

  test('should PUT spreadsheet', async () => {
    const { result, statusCode } = await server.inject({
      method: 'PUT',
      url: pathTo(paths.putSpreadsheet, { uploadId: 123, organisationId: 456 }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      payload: {
        spreadsheet: {
          statusUrl: 'http://example.com/fish'
        }
      }
    })

    expect(result).toEqual({
      message: 'success',
      spreadsheet: {
        organisationId: '456',
        statusUrl: 'http://example.com/fish',
        uploadId: '123',
        version: 1
      }
    })
    expect(statusCode).toBe(200)
  })

  test('should PUT then GET spreadsheet', async () => {
    const putResult = await server.inject({
      method: 'PUT',
      url: pathTo(paths.putSpreadsheet, {
        uploadId: 1234,
        organisationId: 5678
      }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      payload: {
        spreadsheet: {
          statusUrl: 'http://example.com/fish'
        }
      }
    })
    expect(putResult.statusCode).toBe(200)

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: pathTo(paths.getSpreadsheets, {
        organisationId: 5678
      }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      }
    })

    expect(result).toEqual({
      message: 'success',
      spreadsheets: [
        {
          uploadId: '1234',
          organisationId: '5678',
          statusUrl: 'http://example.com/fish',
          version: 1
        }
      ]
    })
    expect(statusCode).toBe(200)

    const r2 = await server.inject({
      method: 'GET',
      url: pathTo(paths.getOneSpreadsheet, {
        organisationId: 5678,
        uploadId: 1234
      }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      }
    })

    expect(r2.result).toEqual({
      message: 'success',
      spreadsheets: [
        {
          uploadId: '1234',
          organisationId: '5678',
          statusUrl: 'http://example.com/fish',
          version: 1
        }
      ]
    })
    expect(r2.statusCode).toBe(200)
  })
})

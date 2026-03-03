import { initialiseServer, WASTE_CLIENT_AUTH_TEST_TOKEN, stopServer } from '../common/helpers/initialse-test-server.js'
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
          fileId: 'file-id'
        }
      }
    })

    expect(result).toEqual({
      message: 'success',
      spreadsheet: {
        organisationId: '456',
        fileId: 'file-id',
        uploadId: '123',
        updatedAtTimstamp: expect.any(Date),
        version: 1
      }
    })
    expect(statusCode).toBe(200)
  })

  test('should return uploads by filename', async () => {
    await server.inject({
      method: 'PUT',
      url: pathTo(paths.putSpreadsheet, { uploadId: 'upload-a', organisationId: 'org-file' }),
      headers: { 'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN },
      payload: { spreadsheet: { filename: 'test-file.xlsx' } }
    })

    await server.inject({
      method: 'PUT',
      url: pathTo(paths.putSpreadsheet, { uploadId: 'upload-b', organisationId: 'org-file' }),
      headers: { 'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN },
      payload: { spreadsheet: { filename: 'test-file.xlsx' } }
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: paths.getUploadsByFilename.replace('{organisationId}', 'org-file') + '?filename=test-file.xlsx',
      headers: { 'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN }
    })

    expect(statusCode).toBe(200)
    expect(result.message).toBe('success')
    expect(result.uploads).toEqual(expect.arrayContaining([{ uploadId: 'upload-a' }, { uploadId: 'upload-b' }]))
  })

  test('should return 404 when no spreadsheets match filename', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: paths.getUploadsByFilename.replace('{organisationId}', 'org-file') + '?filename=nonexistent.xlsx',
      headers: { 'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN }
    })

    expect(statusCode).toBe(404)
  })

  test('should return 400 when filename query param is missing', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: paths.getUploadsByFilename.replace('{organisationId}', 'org-file'),
      headers: { 'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN }
    })

    expect(statusCode).toBe(400)
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
          fileId: 'file-id'
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
          fileId: 'file-id',
          updatedAtTimstamp: expect.any(Date),
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
          fileId: 'file-id',
          updatedAtTimstamp: expect.any(Date),
          version: 1
        }
      ]
    })
    expect(r2.statusCode).toBe(200)
  })
})

import { initialiseServer, WASTE_CLIENT_AUTH_TEST_TOKEN, stopServer } from '../common/helpers/initialse-test-server.js'
import { paths, pathTo } from '../config/paths.js'
import { config } from '../config.js'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { sendSqsMessage } from '../plugins/sqs.js'

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://mock-presigned-url.com/processed-file')
}))

vi.mock('../plugins/sqs.js', (module) => ({
  sendSqsMessage: vi.fn().mockResolvedValue(null),
  sqsPlugin: module.sqsPlugin
}))

const originalGet = config.get.bind(config)

describe('spreadsheet API', () => {
  let server

  beforeAll(async () => {
    server = await initialiseServer()
  })

  afterAll(async () => {
    stopServer(server)
    vi.clearAllMocks()
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
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
          fileId: 'file-id'
        }
      }
    })

    expect(result).toEqual({
      message: 'success',
      spreadsheet: {
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        organisationId: '456',
        fileId: 'file-id',
        traceId: null,
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

  test('should report error scheduling background job', async () => {
    sendSqsMessage.mockRejectedValueOnce(new Error('some error'))

    const { result } = await server.inject({
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

    expect(result.message).toEqual('error')
  })

  test('should return processedFileUrl when upload has s3 coordinates', async () => {
    await server.inject({
      method: 'PUT',
      url: pathTo(paths.putSpreadsheet, { uploadId: 'upload-s3', organisationId: 'org-s3' }),
      headers: { 'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN },
      payload: { spreadsheet: { filename: 's3-file.xlsx', s3Bucket: 'test-bucket', s3Key: 'test-key' } }
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: paths.getUploadsByFilename.replace('{organisationId}', 'org-s3') + '?filename=s3-file.xlsx',
      headers: { 'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN }
    })

    expect(statusCode).toBe(200)
    expect(result.uploads).toEqual([{ uploadId: 'upload-s3', processedFileUrl: 'https://mock-presigned-url.com/processed-file' }])
  })

  test('should omit processedFileUrl when getSignedUrl throws', async () => {
    getSignedUrl.mockRejectedValueOnce(new Error('NoSuchKey'))

    await server.inject({
      method: 'PUT',
      url: pathTo(paths.putSpreadsheet, { uploadId: 'upload-s3-err', organisationId: 'org-s3-err' }),
      headers: { 'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN },
      payload: { spreadsheet: { filename: 's3-err-file.xlsx', s3Bucket: 'test-bucket', s3Key: 'err-key' } }
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: paths.getUploadsByFilename.replace('{organisationId}', 'org-s3-err') + '?filename=s3-err-file.xlsx',
      headers: { 'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN }
    })

    expect(statusCode).toBe(200)
    expect(result.uploads).toEqual([{ uploadId: 'upload-s3-err' }])
  })

  test('should return hasError when upload has error flag', async () => {
    await server.inject({
      method: 'PUT',
      url: pathTo(paths.putSpreadsheet, { uploadId: 'upload-err', organisationId: 'org-err' }),
      headers: { 'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN },
      payload: { spreadsheet: { filename: 'err-file.xlsx', hasError: true } }
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: paths.getUploadsByFilename.replace('{organisationId}', 'org-err') + '?filename=err-file.xlsx',
      headers: { 'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN }
    })

    expect(statusCode).toBe(200)
    expect(result.uploads).toEqual([{ uploadId: 'upload-err', hasError: true }])
  })

  test('should return errorMessage when upload has error details', async () => {
    await server.inject({
      method: 'PUT',
      url: pathTo(paths.putSpreadsheet, { uploadId: 'upload-err-msg', organisationId: 'org-err-msg' }),
      headers: { 'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN },
      payload: { spreadsheet: { filename: 'err-msg-file.xlsx', hasError: true, errorMessage: 'Incompatible file type' } }
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: paths.getUploadsByFilename.replace('{organisationId}', 'org-err-msg') + '?filename=err-msg-file.xlsx',
      headers: { 'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN }
    })

    expect(statusCode).toBe(200)
    expect(result.uploads).toEqual([{ uploadId: 'upload-err-msg', hasError: true, errorMessage: 'Incompatible file type' }])
  })

  test('should return referenceNumber when upload has one', async () => {
    await server.inject({
      method: 'PUT',
      url: pathTo(paths.putSpreadsheet, { uploadId: 'upload-ref', organisationId: 'org-ref' }),
      headers: { 'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN },
      payload: { spreadsheet: { filename: 'ref-file.xlsx', referenceNumber: 'ref-abc-123' } }
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: paths.getUploadsByFilename.replace('{organisationId}', 'org-ref') + '?filename=ref-file.xlsx',
      headers: { 'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN }
    })

    expect(statusCode).toBe(200)
    expect(result.uploads).toEqual([{ uploadId: 'upload-ref', referenceNumber: 'ref-abc-123' }])
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

  test('should return 404 for uploads endpoint when test routes are disabled', async () => {
    vi.spyOn(config, 'get').mockImplementation((key) => {
      if (key === 'isTestRoutesEnabled') return false
      return originalGet(key)
    })
    const disabledServer = await initialiseServer()

    const { statusCode } = await disabledServer.inject({
      method: 'GET',
      url: paths.getUploadsByFilename.replace('{organisationId}', 'org-file') + '?filename=test-file.xlsx',
      headers: { 'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN }
    })

    expect(statusCode).toBe(404)
    vi.restoreAllMocks()
    await stopServer(disabledServer)
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
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
          uploadId: '1234',
          organisationId: '5678',
          traceId: null,
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
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
          uploadId: '1234',
          organisationId: '5678',
          traceId: null,
          fileId: 'file-id',
          updatedAtTimstamp: expect.any(Date),
          version: 1
        }
      ]
    })
    expect(r2.statusCode).toBe(200)
  })
})

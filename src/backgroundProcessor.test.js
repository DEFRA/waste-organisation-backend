import { beforeAll, describe, expect, vi } from 'vitest'
import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs'
import * as mockMongo from 'vitest-mongodb'
import fs from 'node:fs/promises'

import { config } from './config.js'
import * as encryption from './services/decrypt.js'
import * as bulkImportModule from './services/bulkImport.js'
import * as spreadsheetImportModule from './services/spreadsheetImport.js'
import * as excelImportModule from './services/spreadsheetImport/excel.js'
import * as spreadsheetSandboxModule from './services/spreadsheetSandbox.js'
import { sendEmail } from './services/notify/index.js'
import { createLogger } from './common/helpers/logging/logger.js'
import { PermanentApiError, TransientApiError } from './common/helpers/exceptions.js'
import { paymentCollection } from './repositories/payment.js'
import { orgCollection } from './repositories/organisation.js'
import { isPaid, isRefunded } from './domain/payment.js'
import { randomUUID } from 'node:crypto'

const logger = createLogger()

describe('background processor', () => {
  let message
  // The spreadsheet parse now runs out-of-process (sandbox + child download from S3),
  // which these in-process tests can't feed. Tests set `sandboxS3Client` to the fake
  // S3 client they want the (mocked) sandbox to read from; the mock then does the real
  // parse in-process, exactly as the worker would.
  let sandboxS3Client
  const wreckPostMock = vi.fn()
  const wreckPutMock = vi.fn()
  const wreckGetMock = vi.fn()
  const origMongoUrl = config.get('mongo.mongoUrl')

  beforeAll(async () => {
    vi.clearAllMocks()
    message = {
      Body: JSON.stringify({
        s3Bucket: 'randomString',
        s3Key: 'randomString',
        encryptedEmail: 'randomString',
        organisationId: 'randomString',
        uploadId: 'randomString',
        hasError: false,
        uploadType: 'create'
      })
    }

    vi.doMock('@hapi/wreck', () => ({
      default: {
        post: wreckPostMock.mockReturnValue({ payload: { post: 'response' } }),
        put: wreckPutMock.mockReturnValue({ payload: { put: 'response' } }),
        get: wreckGetMock.mockReturnValue({ payload: { get: 'response' } })
      }
    }))

    await mockMongo.setup()
    if (globalThis?.__MONGO_URI__) {
      config.set('mongo.mongoUrl', globalThis.__MONGO_URI__)
    }
  })

  beforeEach(() => {
    sandboxS3Client = null
    // Default: run the real parse in-process from whatever S3 client the test set.
    // Tests that need a specific parse result override this spy in their body.
    vi.spyOn(spreadsheetSandboxModule, 'downloadAndParseSpreadsheetInSandbox').mockImplementation(async ({ organisationId: org, uploadType, logger: log }) => {
      const { Body } = await sandboxS3Client.send()
      const chunks = []
      for await (const chunk of Body) chunks.push(chunk)
      const buffer = Buffer.concat(chunks)
      const { hasErrors, workbook, movements, rowNumbers, errors } = await spreadsheetImportModule.parseExcelFile(buffer, org, log, uploadType)
      const workbookBytes = workbook ? Buffer.from(await spreadsheetImportModule.workbookToByteArray(workbook, log)) : null
      return { hasErrors, errors: errors ?? null, movements: movements ?? null, rowNumbers: rowNumbers ?? null, workbookBytes }
    })
  })

  afterAll(() => {
    config.set('mongo.mongoUrl', origMongoUrl)
  })

  test('fetch S3 object', async () => {
    const { fetchS3Object } = await import('./backgroundProcessor.js')

    const buf = await fetchS3Object(
      {
        send: async (_) => {
          return {
            Body: [Buffer.from('test'), Buffer.from('123')]
          }
        }
      },
      'bucket',
      'key'
    )
    expect(buf.toString()).toBe('test123')
  })

  test('delete sqs message', async () => {
    const { deleteMessage } = await import('./backgroundProcessor.js')
    let sideEffect = {}

    await deleteMessage(
      {
        send: async (cmd) => {
          sideEffect = cmd
        }
      },
      'http://example.com/queue',
      'handle',
      logger
    )
    expect(sideEffect.input.QueueUrl).toEqual('http://example.com/queue')
    expect(sideEffect.input.ReceiptHandle).toEqual('handle')
  })

  test('delete sqs message should handle error', async () => {
    const { deleteMessage } = await import('./backgroundProcessor.js')

    const response = await deleteMessage(
      {
        send: async (_) => {
          throw new Error('Error')
        }
      },
      'http://example.com/queue',
      'handle',
      logger
    )

    expect(response).toBeUndefined()
  })

  test('poll queue happy path - only processes one message at a time', async () => {
    const { pollQueue } = await import('./backgroundProcessor.js')
    const testData = [{ test: 'data1', ReceiptHandle: 'handle1' }]
    const sideEffect = { processedMessages: [], deletedMessages: [] }
    await pollQueue({
      sqsClient: {
        send: async (cmd) => {
          if (cmd instanceof ReceiveMessageCommand) {
            return {
              Messages: testData
            }
          } else if (cmd instanceof DeleteMessageCommand) {
            sideEffect.deletedMessages.push(cmd.input.ReceiptHandle)
          }
        }
      },
      QueueUrl: 'http://example.com/queue',
      action: async (message) => {
        sideEffect.processedMessages.push(message.test)
        return { logger }
      }
    })
    expect(sideEffect.deletedMessages.length).toEqual(testData.length)
    expect(sideEffect.processedMessages.length).toEqual(testData.length)
    for (const { test, ReceiptHandle } of testData) {
      expect(sideEffect.deletedMessages).toContain(ReceiptHandle)
      expect(sideEffect.processedMessages).toContain(test)
    }
  })

  const pollOnce = async (action) => {
    const { pollQueue } = await import('./backgroundProcessor.js')
    const deletedMessages = []
    const response = await pollQueue({
      sqsClient: {
        send: async (cmd) => {
          if (cmd instanceof DeleteMessageCommand) {
            deletedMessages.push(cmd.input.ReceiptHandle)
            return {}
          }
          return { Messages: [{ test: 'data1', ReceiptHandle: 'handle1' }] }
        }
      },
      QueueUrl: 'http://example.com/queue',
      action
    })
    return { response, deletedMessages }
  }

  test('poll queue should not delete message when action throws an unexpected error', async () => {
    const { _, deletedMessages } = await pollOnce(async () => {
      throw new Error('Error')
    })
    expect(deletedMessages).toEqual([])
  })

  test('poll queue should delete message when action throws a PermanentApiError', async () => {
    const { deletedMessages } = await pollOnce(async () => {
      throw new PermanentApiError('Bad Request', { statusCode: 400 })
    })
    expect(deletedMessages).toEqual(['handle1'])
  })

  test('poll queue should keep message for retry when action throws a TransientApiError', async () => {
    const { _, deletedMessages } = await pollOnce(async () => {
      throw new TransientApiError('Service Unavailable', { statusCode: 503 })
    })
    expect(deletedMessages).toEqual([])
  })

  test('poll queue should keep message when action asks to skip delete', async () => {
    const { deletedMessages } = await pollOnce(async () => ({ logger, skipDeleteMessage: true }))
    expect(deletedMessages).toEqual([])
  })

  test('poll queue should handle exception from action', async () => {
    const { pollQueue } = await import('./backgroundProcessor.js')
    const testData = [
      { test: 'data1', ReceiptHandle: 'handle1' },
      { test: 'data2', ReceiptHandle: 'handle2' }
    ]

    const response = await pollQueue({
      sqsClient: {
        send: async (_) => {
          return {
            Messages: testData
          }
        }
      },
      QueueUrl: 'http://example.com/queue',
      action: async (_) => {
        throw new Error('Error')
      }
    })

    expect(response).toBeUndefined()
  })

  test('poll queue should handle exception from sqsClient', async () => {
    const { pollQueue } = await import('./backgroundProcessor.js')
    const response = await pollQueue({
      sqsClient: {
        send: async (_) => {
          throw new Error('error')
        }
      },
      QueueUrl: 'http://example.com/queue',
      action: async (_) => {
        throw new Error('Error')
      }
    })

    expect(response).toBeUndefined()
  })

  test('poll queue should handle no messages', async () => {
    const { pollQueue } = await import('./backgroundProcessor.js')

    const response = await pollQueue({
      sqsClient: {
        send: async (_) => {
          return {
            Messages: null
          }
        }
      },
      QueueUrl: 'http://example.com/queue',
      action: async (_) => {}
    })

    expect(response).toBeUndefined()
  })

  it('should send failed email with file when file data is incorrect', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation(() => 'test@email.com')
    const mockSendFailed = vi.spyOn(sendEmail, 'sendValidationFailed').mockImplementation(vi.fn())

    const s3Client = {
      send: async (_) => {
        const buffer = await fs.readFile('./test-resources/example-spreadsheet.xlsx')
        return {
          Body: [buffer]
        }
      }
    }
    sandboxS3Client = s3Client

    const { dispatchProcessJob } = await import('./backgroundProcessor.js')
    const processSpreadsheetJob = dispatchProcessJob(s3Client)
    const response = await processSpreadsheetJob(message)

    expect(response.logger).toEqual(expect.anything())
    expect(mockSendFailed).toHaveBeenCalled()
  })

  it('should send failed email with no file when not excel file', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation(() => 'test@email.com')
    const mockSendFailed = vi.spyOn(sendEmail, 'sendFailed').mockImplementation(vi.fn())

    const s3Client = {
      send: async (_) => {
        const buffer = Buffer.from('Not Excel')
        return {
          Body: [buffer]
        }
      }
    }
    sandboxS3Client = s3Client

    const { processSpreadsheetJob } = await import('./backgroundProcessor.js')
    const response = await processSpreadsheetJob(s3Client, JSON.parse(message.Body))

    expect(response.logger).toEqual(expect.anything())
    expect(mockSendFailed).toHaveBeenCalled()
  })

  it('should send failed email with file when api returns errors', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation(() => 'test@email.com')
    const mockSendFailed = vi.spyOn(sendEmail, 'sendValidationFailed').mockImplementation(vi.fn())

    const errors = [
      {
        errorType: 'UnexpectedError',
        key: '0.wasteItems.0.ewcCodes.0',
        message: '"[0].wasteItems[0].ewcCodes[0]" must be a valid EWC code from the official list'
      }
    ]

    vi.spyOn(bulkImportModule, 'bulkImport').mockResolvedValue({ errors })

    const s3Client = {
      send: async (_) => {
        const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
        return {
          Body: [buffer]
        }
      }
    }
    sandboxS3Client = s3Client

    const { processSpreadsheetJob } = await import('./backgroundProcessor.js')

    const response = await processSpreadsheetJob(s3Client, JSON.parse(message.Body))

    expect(response.logger).toEqual(expect.anything())
    expect(mockSendFailed).toHaveBeenCalled()
  })

  it('should send success email when api call is successful', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation(() => 'test@email.com')
    const mockSendSuccess = vi.spyOn(sendEmail, 'sendSuccess').mockImplementation(vi.fn())

    vi.spyOn(bulkImportModule, 'bulkImport').mockResolvedValue({
      movements: [{ wasteTrackingId: '26WR8B1H' }]
    })

    const s3Client = {
      send: async (_) => {
        const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
        return {
          Body: [buffer]
        }
      }
    }
    sandboxS3Client = s3Client

    const { processSpreadsheetJob } = await import('./backgroundProcessor.js')

    const response = await processSpreadsheetJob(s3Client, JSON.parse(message.Body))

    expect(response.logger).toEqual(expect.anything())
    expect(mockSendSuccess).toHaveBeenCalled()
  })

  it('should not send email is no movements are returned', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation(() => 'test@email.com')
    const mockSendSuccess = vi.spyOn(sendEmail, 'sendSuccess').mockImplementation(vi.fn())

    vi.spyOn(bulkImportModule, 'bulkImport').mockResolvedValue({
      movements: null
    })

    const s3Client = {
      send: async (_) => {
        const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
        return {
          Body: [buffer]
        }
      }
    }
    sandboxS3Client = s3Client

    const { processSpreadsheetJob } = await import('./backgroundProcessor.js')

    const response = await processSpreadsheetJob(s3Client, JSON.parse(message.Body))

    expect(response.logger).toEqual(expect.anything())
    expect(mockSendSuccess).not.toHaveBeenCalled()
  })

  it('should do nothing if s3 is not set up', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation(() => 'test@email.com')
    const mockSendSuccess = vi.spyOn(sendEmail, 'sendSuccess').mockImplementation(vi.fn())

    message = {
      Body: JSON.stringify({
        encryptedEmail: 'randomString',
        organisationId: 'randomString',
        uploadId: 'randomString',
        hasError: false
      })
    }

    const s3Client = {
      send: async (_) => {
        const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
        return {
          Body: [buffer]
        }
      }
    }
    sandboxS3Client = s3Client

    const { processSpreadsheetJob } = await import('./backgroundProcessor.js')

    await processSpreadsheetJob(s3Client, JSON.parse(message.Body))

    expect(mockSendSuccess).not.toHaveBeenCalled()
  })

  it('should send failed email if file has errors', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation((encryptedString) => {
      if (encryptedString === 'randomStringEmail') {
        return 'test@email.com'
      }

      if (encryptedString === 'randomStringName') {
        return JSON.stringify({
          firstName: 'Joe'
        })
      }

      return null
    })
    const mockSendFailed = vi.spyOn(sendEmail, 'sendFailed').mockImplementation(vi.fn())

    message = {
      Body: JSON.stringify({
        encryptedEmail: 'randomString',
        organisationId: 'randomString',
        uploadId: 'randomString',
        hasError: true
      })
    }

    const s3Client = {
      send: async (_) => {
        const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
        return {
          Body: [buffer]
        }
      }
    }
    sandboxS3Client = s3Client

    const { processSpreadsheetJob } = await import('./backgroundProcessor.js')

    await processSpreadsheetJob(s3Client, JSON.parse(message.Body))

    expect(mockSendFailed).toHaveBeenCalled()
  })

  it('should handle name not being an object', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation((encryptedString) => {
      if (encryptedString === 'randomStringEmail') {
        return 'test@email.com'
      }

      if (encryptedString === 'randomStringName') {
        return 'Random String'
      }

      return null
    })

    const mockSendFailed = vi.spyOn(sendEmail, 'sendFailed').mockImplementation(vi.fn())

    message = {
      Body: JSON.stringify({
        encryptedEmail: 'randomStringEmail',
        encryptedName: 'randomStringName',
        organisationId: 'randomString',
        uploadId: 'randomString',
        hasError: true
      })
    }

    const s3Client = {
      send: async (_) => {
        const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
        return {
          Body: [buffer]
        }
      }
    }
    sandboxS3Client = s3Client

    const { processSpreadsheetJob } = await import('./backgroundProcessor.js')

    await processSpreadsheetJob(s3Client, JSON.parse(message.Body))

    expect(mockSendFailed).toHaveBeenCalled()
  })

  it('should call bulkImport for create uploads', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation(() => 'test@email.com')
    const mockBulkImport = vi.spyOn(bulkImportModule, 'bulkImport').mockResolvedValue({
      movements: [{ wasteTrackingId: 'NEW123' }]
    })
    const mockSendSuccess = vi.spyOn(sendEmail, 'sendSuccess').mockImplementation(vi.fn())

    const createMessage = {
      Body: JSON.stringify({
        s3Bucket: 'bucket',
        s3Key: 'key',
        encryptedEmail: 'enc',
        organisationId: 'org-id',
        uploadId: 'upload-1',
        uploadType: 'create'
      })
    }

    const s3Client = {
      send: async (_) => {
        const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
        return { Body: [buffer] }
      }
    }
    sandboxS3Client = s3Client

    const { processSpreadsheetJob } = await import('./backgroundProcessor.js')
    await processSpreadsheetJob(s3Client, JSON.parse(createMessage.Body))

    expect(mockBulkImport).toHaveBeenCalled()
    expect(mockSendSuccess).toHaveBeenCalled()
  })

  it('should send validation failed when sandbox parse reports errors (create upload)', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation(() => 'test@email.com')
    const mockSendFailed = vi.spyOn(sendEmail, 'sendValidationFailed').mockImplementation(vi.fn())
    // The parse (and its cell-level validation) now runs in the sandboxed child
    // process; here we exercise the orchestration of the pre-API failure path.
    vi.spyOn(spreadsheetSandboxModule, 'downloadAndParseSpreadsheetInSandbox').mockResolvedValue({
      hasErrors: true,
      errors: {
        '7. Waste movement level': [{ coords: [2, 9], message: 'Waste Tracking ID must not be present on a create upload' }],
        '8. Waste item level': []
      },
      movements: null,
      rowNumbers: null,
      workbookBytes: Buffer.from('annotated xl file')
    })
    const mockBulkImport = vi.spyOn(bulkImportModule, 'bulkImport')

    const createMessage = {
      Body: JSON.stringify({
        s3Bucket: 'bucket',
        s3Key: 'key',
        encryptedEmail: 'enc',
        organisationId: 'org-id',
        uploadId: 'upload-create-wtid',
        uploadType: 'create'
      })
    }

    const s3Client = {
      send: async (_) => {
        const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
        return { Body: [buffer] }
      }
    }
    sandboxS3Client = s3Client

    const { processSpreadsheetJob } = await import('./backgroundProcessor.js')
    await processSpreadsheetJob(s3Client, JSON.parse(createMessage.Body))

    // The annotated workbook produced by the sandbox is attached to the email.
    expect(mockSendFailed).toHaveBeenCalledWith(expect.objectContaining({ file: Buffer.from('annotated xl file') }))
    expect(mockBulkImport).not.toHaveBeenCalled()
  })

  it('should send validation failed when sandbox parse reports errors (update upload)', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation(() => 'test@email.com')
    const mockSendFailed = vi.spyOn(sendEmail, 'sendValidationFailed').mockImplementation(vi.fn())
    vi.spyOn(spreadsheetSandboxModule, 'downloadAndParseSpreadsheetInSandbox').mockResolvedValue({
      hasErrors: true,
      errors: {
        '7. Waste movement level': [{ coords: [2, 9], message: 'Waste Tracking ID is required' }],
        '8. Waste item level': []
      },
      movements: null,
      rowNumbers: null,
      workbookBytes: Buffer.from('annotated xl file')
    })
    const mockBulkUpdate = vi.spyOn(bulkImportModule, 'bulkUpdate')

    const updateMessage = {
      Body: JSON.stringify({
        s3Bucket: 'bucket',
        s3Key: 'key',
        encryptedEmail: 'enc',
        organisationId: 'org-id',
        uploadId: 'upload-3',
        uploadType: 'update'
      })
    }

    const s3Client = {
      send: async (_) => {
        const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
        return { Body: [buffer] }
      }
    }
    sandboxS3Client = s3Client

    const { processSpreadsheetJob } = await import('./backgroundProcessor.js')
    await processSpreadsheetJob(s3Client, JSON.parse(updateMessage.Body))

    expect(mockSendFailed).toHaveBeenCalledWith(expect.objectContaining({ file: Buffer.from('annotated xl file') }))
    expect(mockBulkUpdate).not.toHaveBeenCalled()
  })

  it('should call bulkUpdate for update uploads with valid WTIDs and preserve original WTIDs', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation(() => 'test@email.com')
    const mockWorkbook = { xlsx: { writeBuffer: async () => Buffer.from('test') } }
    vi.spyOn(spreadsheetSandboxModule, 'downloadAndParseSpreadsheetInSandbox').mockResolvedValue({
      hasErrors: false,
      movements: [
        {
          wasteTrackingId: 'EXISTING1',
          yourUniqueReference: 'REF1',
          submittingOrganisation: { defraCustomerOrganisationId: 'org-id' },
          wasteItems: []
        }
      ],
      rowNumbers: { REF1: { movementRow: 9, itemRows: [] } },
      errors: null,
      workbookBytes: Buffer.from('test')
    })
    // The success path re-opens the sandbox-returned workbook bytes to attach the file.
    vi.spyOn(excelImportModule, 'readExcelBuffer').mockResolvedValue(mockWorkbook)
    const mockBulkUpdate = vi.spyOn(bulkImportModule, 'bulkUpdate').mockResolvedValue({
      movements: [{ wasteTrackingId: 'EXISTING1' }]
    })
    const mockUpdateCellContent = vi.spyOn(spreadsheetImportModule, 'updateCellContent').mockReturnValue(mockWorkbook)
    const mockSendSuccess = vi.spyOn(sendEmail, 'sendSuccess').mockImplementation(vi.fn())

    const updateMessage = {
      Body: JSON.stringify({
        s3Bucket: 'bucket',
        s3Key: 'key',
        encryptedEmail: 'enc',
        organisationId: 'org-id',
        uploadId: 'upload-2',
        uploadType: 'update'
      })
    }

    const s3Client = {
      send: async (_) => {
        const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
        return { Body: [buffer] }
      }
    }
    sandboxS3Client = s3Client

    const { processSpreadsheetJob } = await import('./backgroundProcessor.js')
    await processSpreadsheetJob(s3Client, JSON.parse(updateMessage.Body))

    expect(mockBulkUpdate).toHaveBeenCalled()
    const sentMovements = mockBulkUpdate.mock.calls[0][1]
    expect(sentMovements[0].wasteTrackingId).toBe('EXISTING1')
    expect(mockUpdateCellContent).not.toHaveBeenCalled()
    expect(mockSendSuccess).toHaveBeenCalled()
  })

  it('should send failed email when bulk API returns non-transient error', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation(() => 'test@email.com')
    vi.spyOn(spreadsheetImportModule, 'parseExcelFile').mockResolvedValue({
      hasErrors: false,
      workbook: { xlsx: { writeBuffer: async () => Buffer.from('test') } },
      movements: [
        {
          yourUniqueReference: 'REF1',
          submittingOrganisation: { defraCustomerOrganisationId: 'org-id' },
          wasteItems: []
        }
      ],
      rowNumbers: { REF1: { movementRow: 9, itemRows: [] } },
      errors: { movements: [], items: [] }
    })
    vi.spyOn(bulkImportModule, 'bulkImport').mockResolvedValue({ failed: true })
    const mockSendFailed = vi.spyOn(sendEmail, 'sendFailed').mockImplementation(vi.fn())

    const createMessage = {
      Body: JSON.stringify({
        s3Bucket: 'bucket',
        s3Key: 'key',
        encryptedEmail: 'enc',
        organisationId: 'org-id',
        uploadId: 'upload-failed',
        uploadType: 'create'
      })
    }

    const s3Client = {
      send: async (_) => {
        const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
        return { Body: [buffer] }
      }
    }
    sandboxS3Client = s3Client

    const { processSpreadsheetJob } = await import('./backgroundProcessor.js')
    await processSpreadsheetJob(s3Client, JSON.parse(createMessage.Body))

    expect(mockSendFailed).toHaveBeenCalledWith({ email: 'test@email.com', name: 'test@email.com', referenceNumber: 'upload-failed' })
  })

  it('should rethrow transient errors from processSpreadsheet', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation(() => 'test@email.com')
    const transientError = new TransientApiError('Service Unavailable', { statusCode: 503 })
    vi.spyOn(bulkImportModule, 'bulkImport').mockRejectedValue(transientError)
    const mockSendFailed = vi.spyOn(sendEmail, 'sendFailed').mockImplementation(vi.fn())

    const transientMessage = {
      Body: JSON.stringify({
        s3Bucket: 'bucket',
        s3Key: 'key',
        encryptedEmail: 'enc',
        organisationId: 'org-id',
        uploadId: 'upload-transient',
        uploadType: 'create'
      })
    }

    const s3Client = {
      send: async (_) => {
        const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
        return { Body: [buffer] }
      }
    }
    sandboxS3Client = s3Client

    const { processSpreadsheetJob } = await import('./backgroundProcessor.js')

    await expect(processSpreadsheetJob(s3Client, JSON.parse(transientMessage.Body))).rejects.toEqual(transientError)
    expect(mockSendFailed).not.toHaveBeenCalled()
  })

  it('should send failed email for non-transient unexpected errors from processSpreadsheet', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation(() => 'test@email.com')
    vi.spyOn(bulkImportModule, 'bulkImport').mockRejectedValue(new Error('Unexpected crash'))
    const mockSendFailed = vi.spyOn(sendEmail, 'sendFailed').mockImplementation(vi.fn())

    const unexpectedErrorMessage = {
      Body: JSON.stringify({
        s3Bucket: 'bucket',
        s3Key: 'key',
        encryptedEmail: 'enc',
        organisationId: 'org-id',
        uploadId: 'upload-unexpected',
        uploadType: 'create'
      })
    }

    const s3Client = {
      send: async (_) => {
        const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
        return { Body: [buffer] }
      }
    }
    sandboxS3Client = s3Client

    const { processSpreadsheetJob } = await import('./backgroundProcessor.js')

    await processSpreadsheetJob(s3Client, JSON.parse(unexpectedErrorMessage.Body))

    expect(mockSendFailed).toHaveBeenCalledWith({
      email: 'test@email.com',
      name: 'test@email.com',
      referenceNumber: 'upload-unexpected',
      logger: expect.anything()
    })
  })

  test('should poll for payment id status', async () => {
    wreckGetMock.mockReturnValue({
      payload: {
        payment_id: 'abc123',
        amount: 1234,
        refund_summary: {
          status: 'available',
          amount_available: 1234,
          amount_submitted: 0
        },
        state: {
          status: 'success',
          finished: true
        },
        metadata: {
          organisationId: 'org-id',
          organisationName: 'organisation name',
          servicePeriodEnd: '2027-05-01T00:00:00Z',
          servicePeriodStart: '2026-05-01T00:00:00Z'
        }
      }
    })
    const { processPaymentJob, constructMongoClient } = await import('./backgroundProcessor.js')
    const db = await constructMongoClient()
    await db
      .collection(paymentCollection)
      .insertOne({ paymentId: 'abc123', organisationId: 'org-id', status: 'payment_in_progress', idempotencyKey: randomUUID(), period: '2026/2027' })
    const result = await processPaymentJob(db, {
      paymentId: 'abc123',
      organisationId: 'org-id',
      initiatedAt: new Date()
    })
    expect(isPaid(result.payment)).toEqual(true)
    expect(result.skipDeleteMessage).toEqual(false)
  })

  test('should drop paymment message after 3 days', async () => {
    const organisationId = randomUUID()
    const paymentId = randomUUID()
    const threeDaysInMS = 3 * 24 * 61 * 60 * 1000
    const threeDaysAgo = new Date(new Date().getTime() - threeDaysInMS)

    wreckGetMock.mockReturnValue({
      payload: {
        payment_id: paymentId,
        amount: 1234,
        refund_summary: {
          status: 'pending',
          amount_available: 1234,
          amount_submitted: 0
        },
        state: {
          status: 'started',
          finished: false
        },
        metadata: {
          organisationId,
          organisationName: 'organisation name',
          servicePeriodEnd: '2027-05-01T00:00:00Z',
          servicePeriodStart: '2026-05-01T00:00:00Z'
        }
      }
    })
    const { dispatchProcessJob, constructMongoClient } = await import('./backgroundProcessor.js')
    const db = await constructMongoClient()
    await db
      .collection(paymentCollection)
      .insertOne({ paymentId, organisationId, status: 'payment_in_progress', idempotencyKey: randomUUID(), period: '2026/2027' })
    await db.collection(orgCollection).insertOne({ organisationId, disableAfter: new Date() })
    const processPaymentJob = dispatchProcessJob(vi.fn(), db)
    const result = await processPaymentJob({ Body: JSON.stringify({ paymentId, organisationId, initiatedAt: threeDaysAgo }) })
    expect(isPaid(result.payment)).toEqual(false)
    expect(isPaid(result.skipDeleteMessage)).toEqual(false)
  })

  test('should poll for refunds', async () => {
    const organisationId = randomUUID()
    const paymentId = randomUUID()
    const govPayResponses = [
      { res: { statusCode: 200 }, payload: { results: [{ payment_id: paymentId }], _links: { next_page: {} } } },
      {
        payload: {
          payment_id: paymentId,
          amount: 1234,
          refund_summary: {
            status: 'success',
            amount_available: 1234,
            amount_submitted: 0
          },
          state: {
            status: 'started',
            finished: false
          },
          metadata: {
            organisationId,
            organisationName: 'organisation name',
            servicePeriodEnd: '2027-05-01T00:00:00Z',
            servicePeriodStart: '2026-05-01T00:00:00Z'
          }
        }
      }
    ]
    let reqCount = 0
    wreckGetMock.mockImplementation(async () => {
      return govPayResponses[reqCount++]
    })

    const { dispatchProcessJob, constructMongoClient } = await import('./backgroundProcessor.js')
    const db = await constructMongoClient()
    await db
      .collection(paymentCollection)
      .insertOne({ paymentId, organisationId, status: 'payment_succeeded', idempotencyKey: randomUUID(), period: '2026/2027' })
    const processRefundJob = dispatchProcessJob(vi.fn(), db)
    const message = {
      refundQuery: 'initiate polling',
      initiatedAt: '2026-07-02T14:41:43.015Z',
      job: {
        _id: '6a455095b06408347685b413',
        name: 'Poll for refunds that have been initiated',
        attempts: 4,
        backoff: { type: 'exponential', delay: 30000 },
        data: {},
        endDate: null,
        priority: 10,
        repeatInterval: '* * * * *',
        repeatTimezone: null,
        shouldSaveResult: false,
        skipDays: null,
        startDate: null,
        finishedCount: 368,
        lastFinishedAt: '2026-07-02T14:41:00.022Z',
        runCount: 369,
        lockedAt: '2026-07-02T14:41:42.976Z',
        type: 'single',
        nextRunAt: '2026-07-02T14:42:00.000Z',
        lastRunAt: '2026-07-02T14:41:43.009Z'
      }
    }
    await processRefundJob({ Body: JSON.stringify(message) })
    const p = await db.collection(paymentCollection).findOne({ paymentId })
    expect(isRefunded(p)).toBe(true)
  })
})

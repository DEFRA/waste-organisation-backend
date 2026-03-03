import { beforeAll, describe, expect, vi } from 'vitest'
import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs'

import * as encryption from './services/decrypt.js'
import * as bulkImportModule from './services/bulkImport.js'
import * as spreadsheetImportModule from './services/spreadsheetImport.js'
import fs from 'node:fs/promises'
import { sendEmail } from './services/notify/index.js'

describe('background processor', () => {
  let message
  const wreckPostMock = vi.fn()
  const wreckPutMock = vi.fn()

  beforeAll(() => {
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
        put: wreckPutMock.mockReturnValue({ payload: { put: 'response' } })
      }
    }))
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
      'handle'
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
      'handle'
    )

    expect(response).toBeUndefined()
  })

  test('poll queue happy path', async () => {
    const { pollQueue } = await import('./backgroundProcessor.js')
    const testData = [
      { test: 'data1', ReceiptHandle: 'handle1' },
      { test: 'data2', ReceiptHandle: 'handle2' }
    ]
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
      }
    })
    expect(sideEffect.deletedMessages.length).toEqual(testData.length)
    expect(sideEffect.processedMessages.length).toEqual(testData.length)
    for (const { test, ReceiptHandle } of testData) {
      expect(sideEffect.deletedMessages).toContain(ReceiptHandle)
      expect(sideEffect.processedMessages).toContain(test)
    }
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

    const { processJob } = await import('./backgroundProcessor.js')
    const response = await processJob(s3Client, message)

    expect(response).toBe(undefined)
    expect(mockSendFailed).toBeCalled()
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

    const { processJob } = await import('./backgroundProcessor.js')
    const response = await processJob(s3Client, message)

    expect(response).toBe(undefined)
    expect(mockSendFailed).toBeCalled()
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

    const { processJob } = await import('./backgroundProcessor.js')

    const response = await processJob(s3Client, message)

    expect(response).toBe(undefined)
    expect(mockSendFailed).toBeCalled()
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

    const { processJob } = await import('./backgroundProcessor.js')

    const response = await processJob(s3Client, message)

    expect(response).toBe(undefined)
    expect(mockSendSuccess).toBeCalled()
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

    const { processJob } = await import('./backgroundProcessor.js')

    const response = await processJob(s3Client, message)

    expect(response).toBe(undefined)
    expect(mockSendSuccess).not.toBeCalled()
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

    const { processJob } = await import('./backgroundProcessor.js')

    const response = await processJob(s3Client, message)

    expect(response).toBe(undefined)
    expect(mockSendSuccess).not.toBeCalled()
  })

  it('should send failed email if file has errors', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation(() => 'test@email.com')
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

    const { processJob } = await import('./backgroundProcessor.js')

    const response = await processJob(s3Client, message)

    expect(response).toBe(undefined)
    expect(mockSendFailed).toBeCalled()
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

    const { processJob } = await import('./backgroundProcessor.js')
    await processJob(s3Client, createMessage)

    expect(mockBulkImport).toHaveBeenCalled()
    expect(mockSendSuccess).toHaveBeenCalled()
  })

  it('should send validation failed when create upload has wasteTrackingIds', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation(() => 'test@email.com')
    const mockWorkbook = {
      xlsx: { writeBuffer: async () => Buffer.from('test') },
      getWorksheet: () => ({ getRow: () => ({ getCell: () => ({ value: null }) }) })
    }
    vi.spyOn(spreadsheetImportModule, 'parseExcelFile').mockResolvedValue({
      hasErrors: false,
      workbook: mockWorkbook,
      movements: [
        {
          wasteTrackingId: 'UNEXPECTED1',
          yourUniqueReference: 'REF1',
          submittingOrganisation: { defraCustomerOrganisationId: 'org-id' },
          wasteItems: []
        }
      ],
      rowNumbers: { REF1: { movementRow: 9, itemRows: [] } },
      errors: { movements: [], items: [] }
    })
    vi.spyOn(spreadsheetImportModule, 'updateErrors').mockReturnValue(mockWorkbook)
    const mockSendFailed = vi.spyOn(sendEmail, 'sendValidationFailed').mockImplementation(vi.fn())
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

    const { processJob } = await import('./backgroundProcessor.js')
    await processJob(s3Client, createMessage)

    expect(mockBulkImport).not.toHaveBeenCalled()
    expect(mockSendFailed).toHaveBeenCalled()
  })

  it('should call bulkUpdate for update uploads with valid WTIDs', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation(() => 'test@email.com')
    const mockWorkbook = { xlsx: { writeBuffer: async () => Buffer.from('test') } }
    vi.spyOn(spreadsheetImportModule, 'parseExcelFile').mockResolvedValue({
      hasErrors: false,
      workbook: mockWorkbook,
      movements: [
        {
          wasteTrackingId: 'EXISTING1',
          yourUniqueReference: 'REF1',
          submittingOrganisation: { defraCustomerOrganisationId: 'org-id' },
          wasteItems: []
        }
      ],
      rowNumbers: { REF1: { movementRow: 9, itemRows: [] } },
      errors: { movements: [], items: [] }
    })
    const mockBulkUpdate = vi.spyOn(bulkImportModule, 'bulkUpdate').mockResolvedValue({
      movements: [{ wasteTrackingId: 'EXISTING1' }]
    })
    vi.spyOn(spreadsheetImportModule, 'updateCellContent').mockReturnValue(mockWorkbook)
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

    const { processJob } = await import('./backgroundProcessor.js')
    await processJob(s3Client, updateMessage)

    expect(mockBulkUpdate).toHaveBeenCalled()
    const sentMovements = mockBulkUpdate.mock.calls[0][1]
    expect(sentMovements[0].wasteTrackingId).toBe('EXISTING1')
    expect(mockSendSuccess).toHaveBeenCalled()
  })

  it('should send failed email when bulk API returns non-transient error', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation(() => 'test@email.com')
    vi.spyOn(bulkImportModule, 'bulkImport').mockResolvedValue({ failed: true })
    const mockSendFailed = vi.spyOn(sendEmail, 'sendFailed').mockImplementation(vi.fn())

    const s3Client = {
      send: async (_) => {
        const buffer = await fs.readFile('./test-resources/valid-spreadsheet.xlsx')
        return { Body: [buffer] }
      }
    }

    const { processJob } = await import('./backgroundProcessor.js')
    const response = await processJob(s3Client, message)

    expect(response).toBe(undefined)
    expect(mockSendFailed).toHaveBeenCalledWith({ email: 'test@email.com' })
  })

  it('should send validation failed when update upload has missing WTIDs', { timeout: 50000 }, async () => {
    vi.spyOn(encryption, 'decrypt').mockImplementation(() => 'test@email.com')
    const mockWorkbook = {
      xlsx: { writeBuffer: async () => Buffer.from('test') },
      getWorksheet: () => ({ getRow: () => ({ getCell: () => ({ value: null }) }) })
    }
    vi.spyOn(spreadsheetImportModule, 'parseExcelFile').mockResolvedValue({
      hasErrors: false,
      workbook: mockWorkbook,
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
    vi.spyOn(spreadsheetImportModule, 'updateErrors').mockReturnValue(mockWorkbook)
    const mockSendFailed = vi.spyOn(sendEmail, 'sendValidationFailed').mockImplementation(vi.fn())
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

    const { processJob } = await import('./backgroundProcessor.js')
    await processJob(s3Client, updateMessage)

    expect(mockBulkUpdate).not.toHaveBeenCalled()
    expect(mockSendFailed).toHaveBeenCalled()
  })
})

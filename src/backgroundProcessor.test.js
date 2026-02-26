import { describe, expect, vi } from 'vitest'
import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs'
import { processJob, fetchS3Object, deleteMessage, pollQueue } from './backgroundProcessor.js'
import * as encryption from './services/decrypt.js'
import * as bulkImportModule from './services/bulkImport.js'
import * as spreadsheetImportModule from './services/spreadsheetImport.js'
import fs from 'node:fs/promises'
import { sendEmail } from './services/notify/index.js'

describe('background processor', () => {
  test('fetch S3 object', async () => {
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

  test('poll queue happy path', async () => {
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
})

describe('processJob', () => {
  const s3ClientForFile = (filePath) => ({
    send: async (_) => {
      const buffer = await fs.readFile(filePath)
      return { Body: [buffer] }
    }
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(encryption, 'decrypt').mockImplementation(() => 'test@email.com')
  })

  it('should send validation failed email for spreadsheet with parse errors', { timeout: 50000 }, async () => {
    const mockSendFailed = vi.spyOn(sendEmail, 'sendValidationFailed').mockImplementation(vi.fn())

    const message = {
      Body: JSON.stringify({
        s3Bucket: 'ghjghj',
        s3Key: 'ghjghj',
        encryptedEmail: 'ghjghj',
        organisationId: 'ghjghj',
        uploadId: 'ghjghj'
      })
    }

    const response = await processJob(s3ClientForFile('./test-resources/example-spreadsheet.xlsx'), message)

    expect(response).toBe(undefined)
    expect(mockSendFailed).toBeCalled()
  })

  it('should call bulkImport for create uploads', { timeout: 50000 }, async () => {
    const mockBulkImport = vi.spyOn(bulkImportModule, 'bulkImport').mockResolvedValue({
      movements: [{ wasteTrackingId: 'NEW123' }]
    })
    const mockSendSuccess = vi.spyOn(sendEmail, 'sendSuccess').mockImplementation(vi.fn())

    const message = {
      Body: JSON.stringify({
        s3Bucket: 'bucket',
        s3Key: 'key',
        encryptedEmail: 'enc',
        organisationId: 'org-id',
        uploadId: 'upload-1',
        uploadType: 'create'
      })
    }

    await processJob(s3ClientForFile('./test-resources/valid-spreadsheet.xlsx'), message)

    expect(mockBulkImport).toHaveBeenCalled()
    expect(mockSendSuccess).toHaveBeenCalled()
  })

  it('should call bulkUpdate for update uploads with valid WTIDs', { timeout: 50000 }, async () => {
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

    const message = {
      Body: JSON.stringify({
        s3Bucket: 'bucket',
        s3Key: 'key',
        encryptedEmail: 'enc',
        organisationId: 'org-id',
        uploadId: 'upload-2',
        uploadType: 'update'
      })
    }

    await processJob(s3ClientForFile('./test-resources/valid-spreadsheet.xlsx'), message)

    expect(mockBulkUpdate).toHaveBeenCalled()
    const sentMovements = mockBulkUpdate.mock.calls[0][1]
    expect(sentMovements[0].wasteTrackingId).toBe('EXISTING1')
    expect(mockSendSuccess).toHaveBeenCalled()
  })

  it('should send validation failed when update upload has missing WTIDs', { timeout: 50000 }, async () => {
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

    const message = {
      Body: JSON.stringify({
        s3Bucket: 'bucket',
        s3Key: 'key',
        encryptedEmail: 'enc',
        organisationId: 'org-id',
        uploadId: 'upload-3',
        uploadType: 'update'
      })
    }

    await processJob(s3ClientForFile('./test-resources/valid-spreadsheet.xlsx'), message)

    expect(mockBulkUpdate).not.toHaveBeenCalled()
    expect(mockSendFailed).toHaveBeenCalled()
  })
})

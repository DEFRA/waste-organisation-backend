import { beforeAll, describe, expect, vi } from 'vitest'
import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs'

import * as encryption from './services/decrypt.js'
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
        uploadId: 'randomString'
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

    wreckPostMock.mockImplementation(() => ({
      payload: { errors }
    }))

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

    const payload = { movements: [{ wasteTrackingId: '26WR8B1H' }] }

    wreckPostMock.mockReturnValue({
      payload
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

    const payload = { movements: null }

    wreckPostMock.mockReturnValue({
      payload
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
        uploadId: 'randomString'
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
})

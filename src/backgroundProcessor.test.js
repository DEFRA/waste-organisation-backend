import { describe, expect } from 'vitest'
import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs'
import { fetchS3Object, deleteMessage, pollQueue } from './backgroundProcessor.js'

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

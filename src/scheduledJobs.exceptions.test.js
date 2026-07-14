import { beforeEach, describe, expect } from 'vitest'
import * as mockMongo from 'vitest-mongodb'
import { config } from './config.js'
import { MongoClient } from 'mongodb'
import { scheduledTasksCollection } from './repositories/scheduledTasks.js'

describe('scheduled tasks handles error', () => {
  const mockSendMessage = vi.fn()
  let db
  let scheduledTasks
  let dbClient

  beforeEach(async () => {
    await mockMongo.setup()
    if (globalThis?.__MONGO_URI__) {
      config.set('mongo.mongoUrl', globalThis.__MONGO_URI__)
      const options = config.get('mongo')

      dbClient = new MongoClient(globalThis.__MONGO_URI__)
      await dbClient.connect()

      db = dbClient.db(options.databaseName)
      scheduledTasks = db.collection(scheduledTasksCollection)

      await scheduledTasks.deleteMany({})

      const mongoLocks = db.collection('mongo-locks')
      await mongoLocks.deleteMany({})
    }
  })

  afterAll(async () => {
    await dbClient.close()
  })

  it('should return the error if an error is thrown', async () => {
    const testError = Error('Random Error')
    vi.doMock('./plugins/sqs.js', () => ({
      constructSqsClient: vi.fn().mockImplementation(() => {
        throw testError
      }),
      sendSqsMessage: mockSendMessage
    }))

    await scheduledTasks.insertMany([{ name: 'test4', runCount: 1, lastFinishedAt: '2026-07-10T16:07:48.699Z', createdAt: '2026-07-10T16:07:48.701Z' }])
    const { startTasks, scheduleBackgroundProcess } = await import('./scheduledJobs.js')

    const scheduledJobs = {
      TEST_TASK: {
        enabled: true,
        name: 'test4',
        schedule: '* * * * * *',
        func: scheduleBackgroundProcess
      }
    }
    const { error } = await startTasks(db, scheduledJobs)

    console.log('error', error)

    expect(error).toBe(testError)
  })
})

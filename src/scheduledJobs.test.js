import { beforeEach, describe, expect } from 'vitest'
import * as mockMongo from 'vitest-mongodb'
import { config } from './config.js'
import { MongoClient } from 'mongodb'
import { scheduledTasksCollection } from './repositories/scheduleTasks.js'

describe('schedulet tasks', () => {
  const mockSqsClient = vi.fn()
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
    }
    vi.doMock('./plugins/sqs.js', () => ({
      constructSqsClient: () => mockSqsClient,
      sendSqsMessage: mockSendMessage
    }))
  })

  afterAll(async () => {
    await dbClient.close()
  })

  it('should run jobs', async () => {
    await scheduledTasks.insertMany([{ name: 'test', runCount: 1, lastFinishedAt: '2026-07-10T16:07:48.699Z', createdAt: '2026-07-10T16:07:48.701Z' }])
    const { startTasks, scheduleBackgroundProcess } = await import('./scheduledJobs.js')
    const scheduledJobs = {
      TEST_TASK: {
        enabled: true,
        name: 'test',
        schedule: '*/10 * * * * *',
        func: scheduleBackgroundProcess
      }
    }
    const { stopScheduling, tasks, error } = await startTasks(scheduledJobs)
    if (error) {
      console.log('error starting tasks', error)
    }
    expect(error).toEqual(undefined)
    expect(typeof stopScheduling).toBe('function')

    const task = tasks[0]
    await task.execute()

    expect(mockSendMessage).toHaveBeenCalledTimes(1)

    expect(mockSendMessage).toHaveBeenCalledWith(
      {
        refundQuery: 'initiate polling',
        initiatedAt: expect.any(Date),
        job: expect.anything()
      },
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
    await stopScheduling()
  })

  it('should skip first job is task is not in the database', async () => {
    const { startTasks, scheduleBackgroundProcess } = await import('./scheduledJobs.js')
    const scheduledJobs = {
      TEST_TASK: {
        enabled: true,
        name: 'test',
        schedule: '*/10 * * * * *',
        func: scheduleBackgroundProcess
      }
    }
    const { stopScheduling, tasks, error } = await startTasks(scheduledJobs)
    if (error) {
      console.log('error starting tasks', error)
    }
    expect(error).toEqual(undefined)
    expect(typeof stopScheduling).toBe('function')

    const task = tasks[0]
    await task.execute()

    expect(mockSendMessage).toHaveBeenCalledTimes(0)

    await stopScheduling()
  })

  it('should set a lock after first run', async () => {
    await scheduledTasks.insertMany([{ name: 'test', runCount: 1, lastFinishedAt: '2026-07-10T16:07:48.699Z', createdAt: '2026-07-10T16:07:48.701Z' }])
    const { startTasks, scheduleBackgroundProcess } = await import('./scheduledJobs.js')
    const scheduledJobs = {
      TEST_TASK: {
        enabled: true,
        name: 'test',
        schedule: '*/10 * * * * *',
        func: scheduleBackgroundProcess
      }
    }
    const { stopScheduling, tasks, error } = await startTasks(scheduledJobs)
    if (error) {
      console.log('error starting tasks', error)
    }
    expect(error).toEqual(undefined)
    expect(typeof stopScheduling).toBe('function')

    const task = tasks[0]
    await task.execute()
    await task.execute()

    expect(mockSendMessage).toHaveBeenCalled()

    await stopScheduling()
  })

  it('should not run jobs if there is a lock in place', async () => {
    await db.collection('mongo-locks').insertOne({ _id: 'test', timestamp: new Date() })
    await scheduledTasks.insertMany([{ name: 'test', runCount: 1, lastFinishedAt: '2026-07-10T16:07:48.699Z', createdAt: '2026-07-10T16:07:48.701Z' }])
    const { startTasks, scheduleBackgroundProcess } = await import('./scheduledJobs.js')
    const scheduledJobs = {
      TEST_TASK: {
        enabled: true,
        name: 'test',
        schedule: '*/10 * * * * *',
        func: scheduleBackgroundProcess
      }
    }
    const { stopScheduling, tasks, error } = await startTasks(scheduledJobs)
    if (error) {
      console.log('error starting tasks', error)
    }
    expect(error).toEqual(undefined)
    expect(typeof stopScheduling).toBe('function')

    const task = tasks[0]
    await task.execute()
    await task.execute()

    expect(mockSendMessage).not.toHaveBeenCalled()

    await stopScheduling()
  })
})

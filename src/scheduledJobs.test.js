import { beforeEach, describe, expect } from 'vitest'
import * as mockMongo from 'vitest-mongodb'
import { config } from './config.js'
import { MongoClient } from 'mongodb'
import { scheduledTasksCollection } from './repositories/scheduledTasks.js'
import { setTimeout } from 'timers/promises'

describe('scheduled tasks', () => {
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

      const mongoLocks = db.collection('mongo-locks')
      await mongoLocks.deleteMany({})
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
    await scheduledTasks.insertMany([{ name: 'test1', runCount: 1, lastFinishedAt: '2026-07-10T16:07:48.699Z', createdAt: '2026-07-10T16:07:48.701Z' }])
    const { startTasks, scheduleBackgroundProcess } = await import('./scheduledJobs.js')
    const scheduledJobs = {
      TEST_TASK: {
        enabled: true,
        name: 'test1',
        schedule: '*/10 * * * * *',
        func: scheduleBackgroundProcess
      }
    }
    const { stopScheduling, tasks } = await startTasks(scheduledJobs)

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
        name: 'test2',
        schedule: '*/10 * * * * *',
        func: scheduleBackgroundProcess
      }
    }
    const { stopScheduling, tasks } = await startTasks(scheduledJobs)

    expect(typeof stopScheduling).toBe('function')

    const task = tasks[0]
    await task.execute()

    expect(mockSendMessage).toHaveBeenCalledTimes(0)

    await stopScheduling()
  })

  it('should not run jobs if there is a lock in place', async () => {
    const deferred = () => {
      let res, rej
      const promise = new Promise((resolve, reject) => {
        res = resolve
        rej = reject
      })
      return { promise, resolve: res, reject: rej }
    }

    await scheduledTasks.insertMany([{ name: 'test4', runCount: 1, lastFinishedAt: '2026-07-10T16:07:48.699Z', createdAt: '2026-07-10T16:07:48.701Z' }])
    const { startTasks } = await import('./scheduledJobs.js')
    let promiseIndex = 0
    const promises = [deferred(), deferred()]
    const results = []

    const scheduledJobs = {
      TEST_TASK: {
        enabled: true,
        name: 'test4',
        schedule: '1 1 1 1 1 1', // schedule is not relevant when calling execute directly
        func: () => () => {
          console.log('running func >>', promiseIndex)
          const p = promises[promiseIndex].promise
          results.push(promiseIndex)
          promiseIndex++
          return p
        }
      }
    }
    const { stopScheduling, tasks } = await startTasks(scheduledJobs, console)

    expect(typeof stopScheduling).toBe('function')

    const task = tasks[0]
    const t1 = task.execute()
    // eslint-disable-next-line no-unmodified-loop-condition
    while (promiseIndex !== 1) {
      console.log('waiting for task 1 to acquire the lock so we can start task 2', promiseIndex)
      await setTimeout(100)
    }

    // Task 2 - this should return without running the task - to ensure that more than one pod triggered by the same
    //          clock event only execute the job once
    await task.execute()

    // allow task 1 to continue
    promises[0].resolve('fish')
    // task one finishes and frees the lock
    await t1

    expect(results).toEqual([0])

    await stopScheduling()
  })

  it('should free the lock to allow tasks to execute sequentially', async () => {
    await scheduledTasks.insertMany([{ name: 'test4', runCount: 1, lastFinishedAt: '2026-07-10T16:07:48.699Z', createdAt: '2026-07-10T16:07:48.701Z' }])
    const { startTasks, scheduleBackgroundProcess } = await import('./scheduledJobs.js')
    const scheduledJobs = {
      TEST_TASK: {
        enabled: true,
        name: 'test4',
        schedule: '*/10 * * * * *',
        func: scheduleBackgroundProcess
      }
    }
    const { stopScheduling, tasks } = await startTasks(scheduledJobs)

    expect(typeof stopScheduling).toBe('function')

    await tasks[0].execute()
    await tasks[0].execute()

    expect(mockSendMessage).toHaveBeenCalledTimes(2)

    await stopScheduling()
  })

  it('should not create disabled tasks', async () => {
    const { startTasks, scheduleBackgroundProcess } = await import('./scheduledJobs.js')
    const scheduledJobs = {
      TEST_TASK: {
        enabled: false,
        name: 'test4',
        schedule: '*/10 * * * * *',
        func: scheduleBackgroundProcess
      }
    }
    const { stopScheduling, tasks } = await startTasks(scheduledJobs)

    expect(tasks).toEqual([])

    await stopScheduling()
  })
})

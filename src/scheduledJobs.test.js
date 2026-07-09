import { afterEach, beforeEach, describe, expect } from 'vitest'
import * as mockMongo from 'vitest-mongodb'
import { config } from './config.js'

describe('schedulet tasks', () => {
  const mockSqsClient = vi.fn()
  const mockSendMessage = vi.fn()

  beforeEach(async () => {
    await mockMongo.setup()
    if (globalThis?.__MONGO_URI__) {
      config.set('mongo.mongoUrl', globalThis.__MONGO_URI__)
    }
    vi.doMock('./plugins/sqs.js', () => ({
      constructSqsClient: () => mockSqsClient,
      sendSqsMessage: mockSendMessage
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should start jobs', async () => {
    vi.useFakeTimers()

    const taskFn = vi.fn()

    const scheduledJobs = {
      TEST_TASK: {
        enabled: true,
        name: 'test',
        schedule: '*/10 * * * * *',
        func: taskFn
      }
    }

    const { startTasks } = await import('./scheduledJobs.js')
    const { stopScheduling, tasks } = await startTasks(scheduledJobs)
    expect(typeof stopScheduling).toBe('function')
    expect(tasks.map((t) => t.getStatus())).toEqual(['idle'])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(taskFn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(taskFn).toHaveBeenCalledTimes(2)
    await stopScheduling()
    expect(tasks.map((t) => t.getStatus())).toEqual(['stopped'])
  })

  it('should run jobs', async () => {
    vi.useFakeTimers()
    const { startTasks, scheduleBackgroundProcess } = await import('./scheduledJobs.js')
    const scheduledJobs = {
      TEST_TASK: {
        enabled: true,
        name: 'test',
        schedule: '*/10 * * * * *',
        func: scheduleBackgroundProcess
      }
    }
    const { stopScheduling, error } = await startTasks(scheduledJobs)
    if (error) {
      console.log('error starting tasks', error)
    }
    expect(error).toEqual(undefined)
    expect(typeof stopScheduling).toBe('function')

    await vi.advanceTimersByTimeAsync(14_000)

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

  it('should start jobs Old', async () => {
    const { startTasksOld } = await import('./scheduledJobs.js')
    const { stopPulseScheduling, pulse } = await startTasksOld()
    expect(typeof stopPulseScheduling).toBe('function')
    const jobs = await pulse.jobs()
    expect(jobs.map((j) => j.attrs.name)).toEqual(['Poll for refunds that have been initiated'])
    const x = await jobs[0].run()
    expect(x.attrs.finishedCount).toEqual(1)
    await stopPulseScheduling()
  })

  it('should run jobs old', async () => {
    const { startTasksOld, scheduleBackgroundProcess } = await import('./scheduledJobs.js')
    const scheduledJobs = {
      TEST_TASK: {
        enabled: true,
        name: 'test',
        schedule: '* * * * *',
        func: scheduleBackgroundProcess
      }
    }
    const { stopPulseScheduling, pulse, error } = await startTasksOld(scheduledJobs)
    if (error) {
      console.log('error starting tasks', error)
    }
    expect(error).toEqual(undefined)
    expect(typeof stopPulseScheduling).toBe('function')
    const jobs = await pulse.jobs()
    const x = await jobs[0].run()
    expect(x.attrs.finishedCount).toBeGreaterThan(0)
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
    // expect(mockSendMessage).toHaveBeenCalled()
    await stopPulseScheduling()
  })
})

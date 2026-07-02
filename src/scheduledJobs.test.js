import { beforeEach, describe, expect } from 'vitest'

describe('schedulet tasks', () => {
  let mockPulse
  let mockSqsClient

  beforeEach(() => {
    mockPulse = {}
    mockSqsClient = {}
  })

  it('should start jobs', async () => {
    const { startTasks, scheduledJobs } = await import('./scheduledJobs.js')
    const { stopPulseScheduling, pulse } = await startTasks(scheduledJobs, mockPulse, console, mockSqsClient, 'mock-queue-url')
    expect(typeof stopPulseScheduling).toBe('function')
    expect((await pulse.jobs()).map((j) => j.attrs.name)).toEqual(['Poll for refunds that have been initiated'])
    await stopPulseScheduling()
  })
})

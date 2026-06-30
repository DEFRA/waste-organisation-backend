import { beforeEach, describe, expect, vi } from 'vitest'

describe('schedulet tasks', () => {
  let mockPulse
  let mockSqsClient

  beforeEach(() => {
    mockPulse = {}
    mockSqsClient = {}
  })

  it('should start jobs', async () => {
    const { startTasks, scheduledJobs } = await import('./scheduledJobs.js')
    const { stopPulseScheduling } = startTasks(scheduledJobs, mockPulse, console, mockSqsClient, 'mock-queue-url')
  })
})

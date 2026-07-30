import { describe, expect } from 'vitest'
import { createLockManager } from './plugins/mongo-lock.js'
import { LockManager } from 'mongo-locks'

const mockMongoDb = (indexes) => {
  return {
    collection: () => ({
      indexes,
      createIndexes: async () => 'ready'
    })
  }
}

describe('scheduled tasks createLockManager', () => {
  it('should create a lock manager with indexes', async () => {
    const timeoutMs = 150
    const fakeMongo = mockMongoDb(async () => [
      { key: { action: 1 }, unique: true },
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 }
    ])
    const lockmanager = await createLockManager(fakeMongo, { timeoutMs })
    expect(lockmanager).toBeInstanceOf(LockManager)
  })
})

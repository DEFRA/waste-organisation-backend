import * as mockMongo from 'vitest-mongodb'
import { MongoClient } from 'mongodb'
import { updateWithOptimisticLock } from './index.js'

describe('mongodb optimisic locking', () => {
  let db
  beforeAll(async () => {
    await mockMongo.setup()
    const client = await MongoClient.connect(globalThis.__MONGO_URI__, {})
    db = client.db('testDatabaseName')
  })

  afterAll(async () => {
    await mockMongo.teardown()
  })

  test('domain function not updating document', async () => {
    const entity = await updateWithOptimisticLock(
      db.collection('thing'),
      { id: 'test' },
      () => null
    )
    expect(entity).toBe(null)
  })

  test('domain function throws exception', async () => {
    try {
      await updateWithOptimisticLock(
        db.collection('thing'),
        { id: 'test' },
        () => {
          throw Error('test error')
        }
      )
      expect(true).toBe(false)
    } catch (e) {
      expect(e.message).toEqual('test error')
    }
  })
})

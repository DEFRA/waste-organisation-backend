import { ObjectId } from 'mongodb'
import { initialiseServer, stopServer } from '../common/helpers/initialse-test-server.js'
import { orgCollection } from '../repositories/organisation.js'
import { setMissingCreatedAtAndUpdatedAtOrganisationFields } from '../../migrations/20261104090000-set-missing-org-timestamps.js'
import { randomUUID } from 'node:crypto'
import { runDbMigrations } from './mongodb.js'
import { createLockManager, acquireLockWithWait } from './mongo-lock.js'

describe('#setMissingCreatedAtAndUpdatedAtOrganisationFields', () => {
  let server

  beforeAll(async () => {
    server = await initialiseServer()
  })

  afterAll(async () => {
    stopServer(server)
  })

  const mockLogger = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }

  test('set-missing-org migration - should update organisations when found', async () => {
    const organisation1Id = new ObjectId('69a6c7e93fa2e7991f78c61d')
    const organisation1Date = new Date('2026-03-03T11:37:13.000Z')
    const organisation2Id = new ObjectId('69a6c7f03fa2e7991f78ca35')
    const organisation2Date = new Date('2026-03-03T11:37:20.000Z')
    const organisations = [
      { _id: organisation1Id, apiCodes: [{ code: randomUUID() }] },
      { _id: organisation2Id, apiCodes: [{ code: randomUUID() }] }
    ]

    await server.db.collection(orgCollection).insertMany(organisations)
    /* migrations already ran (and were recorded in the changelog) when the test server booted - clear the changelog so runDbMigrations re-applies them against these orgs. */
    await server.db.collection('changelog').deleteMany({})
    await runDbMigrations(server.db, console)

    const o1 = await server.db.collection(orgCollection).findOne({ _id: organisation1Id })
    expect(o1.createdAt).toEqual(organisation1Date)
    const o2 = await server.db.collection(orgCollection).findOne({ _id: organisation2Id })
    expect(o2.createdAt).toEqual(organisation2Date)
  })

  test('set-missing-org migration - Should not update organisations when not found', async () => {
    const mockUpdateOne = vi.fn()
    const mockDb = (organisations) => ({
      collection: () => ({
        find: () => ({
          toArray: () => organisations
        }),
        updateOne: mockUpdateOne
      })
    })
    const organisations = []
    await setMissingCreatedAtAndUpdatedAtOrganisationFields(mockDb(organisations), mockLogger)
    expect(mockUpdateOne).not.toHaveBeenCalled()
  })

  test('set-missing-org migration -  should not default any date if date cannot be derived from organisation id', async () => {
    const mockUpdateOne = vi.fn()
    const mockDb = (organisations) => ({
      collection: () => ({
        find: () => ({
          toArray: () => organisations
        }),
        updateOne: mockUpdateOne
      })
    })
    const organisations = [{ _id: 'id123' }]
    await setMissingCreatedAtAndUpdatedAtOrganisationFields(mockDb(organisations), mockLogger)
    expect(mockUpdateOne).toHaveBeenCalledTimes(0)
  })

  test('Should throw so a failed migration fails startup', async () => {
    const error = 'Internal Server Error'
    const mockDb = {
      collection: () => {
        throw new Error(error)
      }
    }

    await expect(setMissingCreatedAtAndUpdatedAtOrganisationFields(mockDb, mockLogger)).rejects.toThrow(error)
  })

  const MIGRATION_LOCK = 'db-migrations'

  test('migration lock - a second pod waits for the lock, then proceeds once it is released', async () => {
    const logger = { info: vi.fn() }
    const podA = await createLockManager(server.db)
    const podB = await createLockManager(server.db)

    /* Pod A holds the lock; release it shortly after pod B has started waiting. */
    const heldByA = await podA.lock(MIGRATION_LOCK)
    expect(heldByA).not.toBeNull()
    const release = setTimeout(() => heldByA.free(), 50)

    const lockForB = await acquireLockWithWait(podB, MIGRATION_LOCK, logger, { intervalMs: 10, timeoutMs: 5000 })
    clearTimeout(release)

    /* Pod B only acquired the lock after A released it, and it logged that it was waiting. */
    expect(lockForB).not.toBeNull()
    expect(logger.info).toHaveBeenCalledWith(`Waiting for '${MIGRATION_LOCK}' lock...`)
    await lockForB.free()
  })

  test('migration lock - a second pod fails if the lock is not released in time', async () => {
    const logger = { info: vi.fn() }
    const podA = await createLockManager(server.db)
    const podB = await createLockManager(server.db)

    /* Pod A holds the lock and never releases it, so pod B must time out. */
    const heldByA = await podA.lock(MIGRATION_LOCK)
    expect(heldByA).not.toBeNull()

    try {
      await expect(acquireLockWithWait(podB, MIGRATION_LOCK, logger, { intervalMs: 10, timeoutMs: 50 })).rejects.toThrow(`Timed out after 50ms waiting for '${MIGRATION_LOCK}' lock`)
    } finally {
      await heldByA.free()
    }
  })
})

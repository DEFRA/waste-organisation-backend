import { Db, MongoClient, ObjectId } from 'mongodb'
import { LockManager } from 'mongo-locks'
import { initialiseServer, stopServer } from '../common/helpers/initialse-test-server.js'
import { setDefaultDisableAfterOrganisationFieldsToNull, setMissingCreatedAtAndUpdatedAtOrganisationFields } from './mongodb.js'
import { mock } from 'node:test'
import { config } from '../config.js'

describe('#mongoDb', () => {
  let server

  beforeAll(async () => {
    server = await initialiseServer()
  })

  afterAll(async () => {
    stopServer(server)
  })

  describe('Set up', () => {
    test('Server should have expected MongoDb decorators', () => {
      expect(server.db).toBeInstanceOf(Db)
      expect(server.mongoClient).toBeInstanceOf(MongoClient)
      expect(server.locker).toBeInstanceOf(LockManager)
    })

    test('MongoDb should have expected database name', () => {
      expect(server.db.databaseName).toBe('waste-organisation-backend')
    })

    test('MongoDb should have expected namespace', () => {
      expect(server.db.namespace).toBe('waste-organisation-backend')
    })
  })

  describe('Shut down', () => {
    test('Should close Mongo client on server stop', async () => {
      const closeSpy = vi.spyOn(server.mongoClient, 'close')
      await server.stop({ timeout: 1000 })

      expect(closeSpy).toHaveBeenCalledWith(true)
    })
  })
})

describe('#setMissingCreatedAtAndUpdatedAtOrganisationFields', () => {
  const mockUpdateOne = vi.fn()
  const mockDb = (organisations) => ({
    collection: () => ({
      find: () => ({
        toArray: () => organisations
      }),
      updateOne: mockUpdateOne
    })
  })
  const mockLogger = {
    error: vi.fn()
  }

  test('Should update Organisations when Organisations are found', async () => {
    const organisation1Id = new ObjectId('69a6c7e93fa2e7991f78c61d')
    const organisation1Date = new Date('2026-03-03T11:37:13.000Z')
    const organisation2Id = new ObjectId('69a6c7f03fa2e7991f78ca35')
    const organisation2Date = new Date('2026-03-03T11:37:20.000Z')
    const organisations = [{ _id: organisation1Id }, { _id: organisation2Id }]

    await setMissingCreatedAtAndUpdatedAtOrganisationFields(mockDb(organisations), mockLogger)

    expect(mockUpdateOne)
      .toHaveBeenCalledTimes(2)
      .toHaveBeenCalledWith({ _id: organisation1Id }, { $set: { createdAt: organisation1Date, updatedAt: organisation1Date } })
      .toHaveBeenCalledWith({ _id: organisation2Id }, { $set: { createdAt: organisation2Date, updatedAt: organisation2Date } })
  })

  test('Should not update Organisations when no Organisations are found', async () => {
    const organisations = []

    await setMissingCreatedAtAndUpdatedAtOrganisationFields(mockDb(organisations), mockLogger)

    expect(mockUpdateOne).not.toHaveBeenCalled()
  })

  test('Should default to current date if date cannot be derived from Organisation id', async () => {
    const organisations = [{ _id: 'id123' }]
    const date = new Date('2026-07-08')

    mock.timers.enable({ apis: ['Date'], now: date })

    await setMissingCreatedAtAndUpdatedAtOrganisationFields(mockDb(organisations), mockLogger)

    expect(mockUpdateOne)
      .toHaveBeenCalledTimes(1)
      .toHaveBeenCalledWith({ _id: 'id123' }, { $set: { createdAt: date, updatedAt: date } })
  })

  test('Should log and not throw errors', async () => {
    const error = 'Internal Server Error'
    const mockDb = {
      collection: () => {
        throw new Error(error)
      }
    }

    await expect(() => setMissingCreatedAtAndUpdatedAtOrganisationFields(mockDb, mockLogger)).not.toThrow()
    expect(mockLogger.error).toHaveBeenCalledWith(`Failed to set missing createdAt and updatedAt Organisation fields: ${error}`)
  })
})

describe('#setDefaultDisableAfterOrganisationFieldsToNull', () => {
  const mockUpdateOne = vi.fn()
  const mockFind = vi.fn()
  const mockDb = (organisations) => ({
    collection: () => ({
      find: mockFind.mockReturnValue({
        toArray: () => organisations
      }),
      updateOne: mockUpdateOne
    })
  })
  const mockLogger = {
    error: vi.fn()
  }
  const originalFreePeriodEnd = config.get('govPay.serviceChargeFreePeriodEnd')

  beforeEach(() => {
    vi.clearAllMocks()
    config.set('govPay.serviceChargeFreePeriodEnd', new Date('2026-10-01T00:00:00.000Z'))
  })

  afterAll(() => {
    config.set('govPay.serviceChargeFreePeriodEnd', originalFreePeriodEnd)
  })

  test('Should update Organisations when legacy default disableAfter values are found', async () => {
    const organisations = [{ _id: 'org-1' }, { _id: 'org-2' }]

    await setDefaultDisableAfterOrganisationFieldsToNull(mockDb(organisations), mockLogger)

    expect(mockFind).toHaveBeenCalledWith({ disableAfter: new Date('2026-10-01T00:00:00.000Z') })
    expect(mockUpdateOne)
      .toHaveBeenCalledTimes(2)
      .toHaveBeenCalledWith({ _id: 'org-1' }, { $set: { disableAfter: null } })
      .toHaveBeenCalledWith({ _id: 'org-2' }, { $set: { disableAfter: null } })
  })

  test('Should not update Organisations when no matching Organisations are found', async () => {
    await setDefaultDisableAfterOrganisationFieldsToNull(mockDb([]), mockLogger)
    expect(mockUpdateOne).not.toHaveBeenCalled()
  })

  test('Should be safe to run repeatedly', async () => {
    const foundSets = [[{ _id: 'org-1' }], []]
    const mockDb = {
      collection: () => ({
        find: () => ({
          toArray: () => foundSets.shift()
        }),
        updateOne: mockUpdateOne
      })
    }

    await setDefaultDisableAfterOrganisationFieldsToNull(mockDb, mockLogger)
    await setDefaultDisableAfterOrganisationFieldsToNull(mockDb, mockLogger)

    expect(mockUpdateOne).toHaveBeenCalledTimes(1)
    expect(mockUpdateOne).toHaveBeenCalledWith({ _id: 'org-1' }, { $set: { disableAfter: null } })
  })

  test('Should log and not throw errors', async () => {
    const error = 'Internal Server Error'
    const mockDb = {
      collection: () => {
        throw new Error(error)
      }
    }

    await expect(() => setDefaultDisableAfterOrganisationFieldsToNull(mockDb, mockLogger)).not.toThrow()
    expect(mockLogger.error).toHaveBeenCalledWith(`Failed to set default disableAfter Organisation fields to null: ${error}`)
  })
})

import { Db, MongoClient, ObjectId } from 'mongodb'
import { LockManager } from 'mongo-locks'
import { initialiseServer, stopServer } from '../common/helpers/initialse-test-server.js'
import { setMissingCreatedAtAndUpdatedAtOrganisationFields } from './mongodb.js'
import { mock } from 'node:test'

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

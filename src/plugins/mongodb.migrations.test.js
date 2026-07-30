import { ObjectId } from 'mongodb'
import { initialiseServer, stopServer } from '../common/helpers/initialse-test-server.js'
import { setMissingCreatedAtAndUpdatedAtOrganisationFields, orgCollection } from '../repositories/organisation.js'
import { randomUUID } from 'node:crypto'
import { runDbMigrations } from './mongodb.js'

describe('#setMissingCreatedAtAndUpdatedAtOrganisationFields', () => {
  let server

  beforeAll(async () => {
    server = await initialiseServer()
  })

  afterAll(async () => {
    stopServer(server)
  })

  const mockLogger = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }

  test('Should update Organisations when Organisations are found', async () => {
    const organisation1Id = new ObjectId('69a6c7e93fa2e7991f78c61d')
    const organisation1Date = new Date('2026-03-03T11:37:13.000Z')
    const organisation2Id = new ObjectId('69a6c7f03fa2e7991f78ca35')
    const organisation2Date = new Date('2026-03-03T11:37:20.000Z')
    const organisations = [
      { _id: organisation1Id, apiCodes: [{ code: randomUUID() }] },
      { _id: organisation2Id, apiCodes: [{ code: randomUUID() }] }
    ]

    await server.db.collection(orgCollection).insertMany(organisations)
    // await setMissingCreatedAtAndUpdatedAtOrganisationFields(server.db, mockLogger)
    await runDbMigrations(server.db, console)

    const o1 = await server.db.collection(orgCollection).findOne({ _id: organisation1Id })
    expect(o1.createdAt).toEqual(organisation1Date)
    const o2 = await server.db.collection(orgCollection).findOne({ _id: organisation2Id })
    expect(o2.createdAt).toEqual(organisation2Date)
  })

  test('Should not update Organisations when no Organisations are found', async () => {
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

  test('Should not default any date if date cannot be derived from Organisation id', async () => {
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

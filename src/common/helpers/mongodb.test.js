import { Db, MongoClient } from 'mongodb'
import { LockManager } from 'mongo-locks'
import { initialiseServer, stopServer } from './initialse-test-server.js'

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

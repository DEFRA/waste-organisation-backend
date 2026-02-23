import { initialiseServer, stopServer } from '../common/helpers/initialse-test-server.js'
import { config } from '../config.js'

const originalGet = config.get.bind(config)

describe('swagger documentation', () => {
  describe('when swagger is enabled', () => {
    let server

    beforeAll(async () => {
      vi.spyOn(config, 'get').mockImplementation((key) => {
        if (key === 'isSwaggerEnabled') return true
        return originalGet(key)
      })
      server = await initialiseServer()
    })

    afterAll(async () => {
      vi.restoreAllMocks()
      await stopServer(server)
    })

    test('should serve swagger UI at /swagger', async () => {
      const { statusCode } = await server.inject({ method: 'GET', url: '/swagger' })
      expect(statusCode).toBe(200)
    })
  })

  describe('when swagger is disabled', () => {
    let server

    beforeAll(async () => {
      vi.spyOn(config, 'get').mockImplementation((key) => {
        if (key === 'isSwaggerEnabled') return false
        return originalGet(key)
      })
      server = await initialiseServer()
    })

    afterAll(async () => {
      vi.restoreAllMocks()
      await stopServer(server)
    })

    test('should return 404 for /swagger', async () => {
      const { statusCode } = await server.inject({ method: 'GET', url: '/swagger' })
      expect(statusCode).toBe(404)
    })
  })
})

import hapi from '@hapi/hapi'
import {
  initInMemMongo,
  stopInMemMongo
} from './common/helpers/initialse-test-server.js'

describe('app entry point', () => {
  let hapiServerSpy

  beforeAll(async () => {
    await initInMemMongo()
    vi.stubEnv('PORT', '3098')
    hapiServerSpy = vi.spyOn(hapi, 'server')
  })

  afterAll(async () => {
    vi.resetAllMocks()
    await stopInMemMongo()
  })

  describe('When code is loaded', () => {
    test('should start server', async () => {
      await import('./index.js')
      expect(hapiServerSpy).toHaveBeenCalled()
    })
  })
})

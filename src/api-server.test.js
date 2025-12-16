import hapi from '@hapi/hapi'

describe('app entry point', () => {
  let hapiServerSpy

  beforeAll(async () => {
    vi.stubEnv('PORT', '3098')
    hapiServerSpy = vi.spyOn(hapi, 'server')
  })

  afterAll(() => {
    vi.resetAllMocks()
  })

  describe('When code is loaded', () => {
    test('should start server', async () => {
      await import('./index.js')
      expect(hapiServerSpy).toHaveBeenCalled()
    })
  })
})

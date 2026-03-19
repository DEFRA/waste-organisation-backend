import { loggerOptions } from './logger-options'
import { faker } from '@faker-js/faker'

import * as tracing from '@defra/hapi-tracing'

describe('loggerOptions', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should return traceId when provided', () => {
    const traceId = faker.string.uuid()
    const options = loggerOptions(traceId)
    const expected = options.mixin()

    expect(expected.trace.id).toBe(traceId)
  })

  it('should return header traceId if traceId is not provided', () => {
    const traceId = faker.string.uuid()
    vi.mock('@defra/hapi-tracing', { spy: true })

    vi.spyOn(tracing, 'getTraceId').mockReturnValue(traceId)

    const options = loggerOptions()
    const expected = options.mixin()

    expect(expected.trace.id).toBe(traceId)
  })

  describe('getChildBindings', () => {
    it('should return trace id and req when tracing header is present', () => {
      const traceId = faker.string.uuid()
      const request = { headers: { 'x-cdp-request-id': traceId } }
      const options = loggerOptions()
      const bindings = options.getChildBindings(request)

      expect(bindings).toEqual({ req: request, trace: { id: traceId } })
    })

    it('should return only req when tracing header is absent', () => {
      const request = { headers: {} }
      const options = loggerOptions()
      const bindings = options.getChildBindings(request)

      expect(bindings).toEqual({ req: request })
    })
  })

  it('should not return traceId if traceId is not set', () => {
    vi.mock('@defra/hapi-tracing', { spy: true })

    vi.spyOn(tracing, 'getTraceId').mockReturnValue(null)

    const options = loggerOptions()
    const expected = options.mixin()

    expect(expected.trace).toBe(undefined)
  })
})

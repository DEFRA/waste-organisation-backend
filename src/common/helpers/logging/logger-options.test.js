import { loggerOptions } from './logger-options'
import { faker } from '@faker-js/faker'

import * as tracing from '@defra/hapi-tracing'

vi.mock('@defra/hapi-tracing', { spy: true })

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

    vi.spyOn(tracing, 'getTraceId').mockReturnValue(traceId)

    const options = loggerOptions()
    const expected = options.mixin()

    expect(expected.trace.id).toBe(traceId)
  })

  it('should not return traceId if traceId is not set', () => {
    vi.spyOn(tracing, 'getTraceId').mockReturnValue(null)

    const options = loggerOptions()
    const expected = options.mixin()

    expect(expected.trace).toBe(undefined)
  })
})

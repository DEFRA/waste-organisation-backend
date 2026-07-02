import { beforeAll, describe, expect, vi } from 'vitest'
import { config } from '../../config.js'

describe('govpay', () => {
  const wreckGetMock = vi.fn()

  beforeAll(async () => {
    config.set('govPay.schedulingPollingTaskRetrySleepStep', 1)
    vi.doMock('@hapi/wreck', () => ({
      default: {
        get: wreckGetMock
      }
    }))
  })
  afterAll(() => {
    vi.clearAllMocks()
  })

  test('generator func paginates correctly', async () => {
    const govPayResponses = [
      { res: { statusCode: 200 }, payload: { results: [1, 2, 3], _links: { next_page: { href: 'test' } } } },
      { res: { statusCode: 'timeout' } },
      { res: { statusCode: 200 }, payload: { results: [4, 5, 6], _links: { next_page: { href: 'test' } } } },
      { res: { statusCode: 'timeout' } },
      { res: { statusCode: 'timeout' } },
      { res: { statusCode: 'timeout' } },
      { res: { statusCode: 'timeout' } },
      { res: { statusCode: 'timeout' } },
      { res: { statusCode: 'timeout' } },
      { res: { statusCode: 200 }, payload: { results: [7, 8, 9], _links: { next_page: { href: 'test' } } } },
      { res: { statusCode: 200 }, payload: { results: [10], _links: { next_page: {} } } }
    ]
    let page = 0
    wreckGetMock.mockImplementation(async () => {
      return govPayResponses[page++]
    })
    const { getRefundsBetween } = await import('./index.js')
    let i = 0
    for await (const x of getRefundsBetween(new Date(), new Date(), console)) {
      i++
      expect(x).toBe(i)
    }
    expect(i).toBe(10)
  })

  test('generator func eventually fails', async () => {
    wreckGetMock.mockImplementation(async () => {
      return { res: { statusCode: 'timeout' } }
    })
    const { getRefundsBetween } = await import('./index.js')
    let x = null
    try {
      for await (const x of getRefundsBetween(new Date(), new Date(), console)) {
        expect(true).toBe(false)
      }
    } catch (e) {
      x = 'pass'
    }
    expect(x).toEqual('pass')
  })
})

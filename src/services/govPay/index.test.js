import { beforeAll, describe, expect, vi } from 'vitest'
import { config } from '../../config.js'

describe('govpay', () => {
  const wreckGetMock = vi.fn()
  const wreckPostMock = vi.fn()

  beforeAll(async () => {
    config.set('govPay.schedulingPollingTaskRetrySleepStep', 1)
    vi.doMock('@hapi/wreck', () => ({
      default: {
        get: wreckGetMock,
        post: wreckPostMock
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
      for await (const thing of getRefundsBetween(new Date(), new Date(), console)) {
        expect(thing).toBe('not a thing - this test should always fail')
      }
    } catch (_) {
      x = 'pass'
    }
    expect(x).toEqual('pass')
  })

  test('createGovPayPayment includes language on the outbound payload', async () => {
    wreckPostMock.mockResolvedValue({
      res: { statusCode: 201 },
      payload: { payment_id: 'pay-123' }
    })
    const { createGovPayPayment } = await import('./index.js')
    const result = await createGovPayPayment(
      {
        reference: 'DWT-2026/2027-org',
        amount: 2134,
        description: 'SERVICE_CHARGE_DESCRIPTION',
        returnUrl: 'http://example.com/paymentDetails',
        metadata: { organisationId: 'org-1' },
        idempotencyKey: 'idem-1',
        language: 'cy'
      },
      console
    )

    expect(result.status).toBe('success')
    expect(wreckPostMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/payments$/),
      expect.objectContaining({
        payload: expect.objectContaining({
          amount: 2134,
          description: 'SERVICE_CHARGE_DESCRIPTION',
          reference: 'DWT-2026/2027-org',
          return_url: 'http://example.com/paymentDetails',
          language: 'cy'
        })
      })
    )
  })
})

import { initialiseServer, WASTE_CLIENT_AUTH_TEST_TOKEN, stopServer } from '../common/helpers/initialse-test-server.js'
import { paths, pathTo } from '../config/paths.js'

describe('payment API', () => {
  let server
  const wreckPostMock = vi.fn()

  beforeAll(async () => {
    vi.clearAllMocks()
    vi.doMock('@hapi/wreck', () => ({
      default: {
        post: wreckPostMock.mockReturnValue({ payload: { post: 'response' } })
      }
    }))
    server = await initialiseServer()
  })

  afterAll(async () => {
    stopServer(server)
  })

  test('Should PUT org', async () => {
    const { result, statusCode } = await server.inject({
      method: 'PUT',
      url: pathTo(paths.payment, { organisationId: 123, paymentId: 456 }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      payload: {
        payment: {
          status: 'FAILED'
        }
      }
    })

    expect(result).toEqual({
      message: 'success',
      payment: {
        status: 'FAILED',
        paymentId: '456',
        organisationId: '123',
        version: 1
      }
    })
    expect(statusCode).toBe(200)
  })

  test('Should get org', async () => {
    const r1 = await server.inject({
      method: 'PUT',
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      url: pathTo(paths.payment, { organisationId: 111, paymentId: 999 }),
      payload: { payment: { status: 'PENDING' } }
    })
    expect(r1.statusCode).toBe(200)
    expect(r1.result.payment.paymentId).toEqual('999')
    const { result, statusCode } = await server.inject({
      method: 'GET',
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      url: pathTo(paths.payment, { organisationId: 111, paymentId: 999 })
    })
    expect(result).toEqual({
      message: 'success',
      payment: {
        status: 'PENDING',
        paymentId: '999',
        organisationId: '111',
        version: 1
      }
    })
    expect(statusCode).toBe(200)
  })

  test('initiate payment', async () => {
    const organisationId = 'abc123'
    wreckPostMock.mockImplementation(async () => {
      return {
        res: {
          statusCode: 200
        },
        payload: {
          amount: 14500,
          description: 'Pay your council tax.',
          reference: '12345',
          language: 'en',
          state: {
            status: 'created',
            finished: false
          },
          payment_id: 'hu20sqlact5260q2nanm0q8u93',
          payment_provider: 'stripe',
          created_date: '2022-03-25T13:11:29.019Z',
          refund_summary: {
            status: 'pending',
            amount_available: 14500,
            amount_submitted: 0
          },
          settlement_summary: {},
          delayed_capture: false,
          moto: false,
          return_url: 'https://your.service.gov.uk/completed',
          _links: {
            self: {
              href: 'https://publicapi.payments.service.gov.uk/v1/payments/hu20sqlact5260q2nanm0q8u93',
              method: 'GET'
            },
            next_url: {
              href: 'https://www.payments.service.gov.uk/secure/ef1b6ff1-db34-4c62-b854-3ed4ba3c4049',
              method: 'GET'
            },
            next_url_post: {
              type: 'application/x-www-form-urlencoded',
              params: {
                chargeTokenId: 'ef1b6ff1-db34-4c62-b854-3ed4ba3c4049'
              },
              href: 'https://www.payments.service.gov.uk/secure',
              method: 'POST'
            },
            events: {
              href: 'https://publicapi.payments.service.gov.uk/v1/payments/hu20sqlact5260q2nanm0q8u93/events',
              method: 'GET'
            },
            refunds: {
              href: 'https://publicapi.payments.service.gov.uk/v1/payments/hu20sqlact5260q2nanm0q8u93/refunds',
              method: 'GET'
            },
            cancel: {
              href: 'https://publicapi.payments.service.gov.uk/v1/payments/hu20sqlact5260q2nanm0q8u93/cancel',
              method: 'POST'
            }
          },
          metadata: {
            organisationId,
            organisationName: 'organisation name'
          }
        }
      }
    })
    const { statusCode, payload } = await server.inject({
      method: 'POST',
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      url: pathTo(paths.initiatePayment, { organisationId }),
      payload: {
        payment: {
          amount: 2134,
          description: 'SERVICE_CHARGE_DESCRIPTION',
          return_url: `http://example.com/paymentDetails`,
          status: 'PENDING',
          metadata: {
            organisationId,
            organisationName: 'organisation name'
          }
        }
      }
    })
    expect(statusCode).toBe(200)
    expect(JSON.parse(payload)).toEqual({
      message: 'success',
      payment: {
        paymentId: 'hu20sqlact5260q2nanm0q8u93',
        organisationId: 'abc123',
        amount: 2134,
        description: 'SERVICE_CHARGE_DESCRIPTION',
        metadata: { organisationId: 'abc123', organisationName: 'organisation name' },
        reference: expect.anything(),
        returnUrl: null,
        status: 'payment_in_progress',
        version: 1
      }
    })
  })
})

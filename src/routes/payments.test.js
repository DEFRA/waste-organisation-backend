import { initialiseServer, WASTE_CLIENT_AUTH_TEST_TOKEN, stopServer } from '../common/helpers/initialse-test-server.js'
import { paths, pathTo } from '../config/paths.js'
import { orgCollection } from '../repositories/organisation.js'

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

  test('Should error if payment not found', async () => {
    const organisationId = 'abc123'
    const paymentId = 'blahblah'
    const payment = fakeGovPayResponse(organisationId).payload
    const r = await updatePayment(server, organisationId, paymentId, { payment })
    expect(r.statusCode).toBe(404)
  })

  const fakeGovPayResponse = (organisationId) => ({
    res: {
      statusCode: 201
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
        status: 'available',
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
        organisationName: 'organisation name',
        servicePeriodStart: '2026-05-01T00:00:00Z',
        servicePeriodEnd: '2027-05-01T00:00:00Z'
      }
    }
  })

  test('initiate payment', async () => {
    const organisationId = 'abc123'
    wreckPostMock.mockImplementation(async () => {
      return fakeGovPayResponse(organisationId)
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
          returnUrl: `http://example.com/paymentDetails`,
          metadata: {
            organisationId,
            organisationName: 'organisation name',
            servicePeriodStart: '2026-05-01T00:00:00Z',
            servicePeriodEnd: '2027-05-01T00:00:00Z'
          }
        }
      }
    })
    expect(statusCode).toBe(200)
    expect(JSON.parse(payload)).toEqual({
      message: 'success',
      payment: {
        amount: 2134,
        govPayLinks: {
          cancel: {
            href: 'https://publicapi.payments.service.gov.uk/v1/payments/hu20sqlact5260q2nanm0q8u93/cancel',
            method: 'POST'
          },
          events: {
            href: 'https://publicapi.payments.service.gov.uk/v1/payments/hu20sqlact5260q2nanm0q8u93/events',
            method: 'GET'
          },
          next_url: {
            href: 'https://www.payments.service.gov.uk/secure/ef1b6ff1-db34-4c62-b854-3ed4ba3c4049',
            method: 'GET'
          },
          next_url_post: {
            href: 'https://www.payments.service.gov.uk/secure',
            method: 'POST',
            params: {
              chargeTokenId: 'ef1b6ff1-db34-4c62-b854-3ed4ba3c4049'
            },
            type: 'application/x-www-form-urlencoded'
          },
          refunds: {
            href: 'https://publicapi.payments.service.gov.uk/v1/payments/hu20sqlact5260q2nanm0q8u93/refunds',
            method: 'GET'
          },
          self: {
            href: 'https://publicapi.payments.service.gov.uk/v1/payments/hu20sqlact5260q2nanm0q8u93',
            method: 'GET'
          }
        },
        metadata: {
          organisationId: 'abc123',
          organisationName: 'organisation name',
          servicePeriodEnd: '2027-05-01T00:00:00Z',
          servicePeriodStart: '2026-05-01T00:00:00Z'
        },
        organisationId: 'abc123',
        paymentId: 'hu20sqlact5260q2nanm0q8u93',
        reference: expect.anything(),
        returnUrl: 'http://example.com/paymentDetails',
        servicePeriodEnd: '2027-05-01T00:00:00.000Z',
        servicePeriodStart: '2026-05-01T00:00:00.000Z',
        status: 'payment_in_progress',
        version: 1
      }
    })
  })

  test('initiate payment should reject non-matching org ids', async () => {
    const organisationId = 'abc123'
    wreckPostMock.mockImplementation(async () => {
      return fakeGovPayResponse(organisationId)
    })
    const { statusCode } = await server.inject({
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
            organisationId: 'blah blah blah blah blah blah blah blah',
            organisationName: 'organisation name'
          }
        }
      }
    })
    expect(statusCode).toBe(403)
  })

  test('initiate payment should handle errors in gov pay', async () => {
    const organisationId = 'abc123'
    wreckPostMock.mockImplementation(async () => {
      throw new Error('fish')
    })
    const { payload, statusCode } = await initiatePayment(server, organisationId, 'organisation name')
    expect(payload).toBe('{"message":"error","errors":[{"message":"GovPay returned status undefined"}]}')
    expect(statusCode).toBe(200)
  })

  test('update payment with `success` enables org', async () => {
    const organisationId = 'abc123'
    wreckPostMock.mockImplementation(async () => {
      return fakeGovPayResponse(organisationId)
    })
    const organisation = { organisationId, name: 'Weyland-Yutani Corporation', isDisabled: true }
    const r = await updateOrganisation(server, 'user123', organisationId, organisation)
    expect(JSON.parse(r.payload).organisation.isDisabled).toBe(true)
    const r1 = await initiatePayment(server, organisationId, 'organisation name', '2026-05-01T00:00:00.000Z', '2027-05-01T00:00:00.000Z')
    expect(r1.statusCode).toBe(200)
    const { paymentId } = JSON.parse(r1.payload).payment

    const payment = fakeGovPayResponse(organisationId).payload
    payment.state.status = 'success'
    payment.state.finished = true
    const r2 = await updatePayment(server, organisationId, paymentId, { payment })

    expect(r2.statusCode).toBe(200)
    const org = await server.db.collection(orgCollection).findOne({ organisationId: { $eq: organisationId } }, { projection: { _id: 0 } })
    expect(org.isDisabled).toBe(false)
  })
})

const updateOrganisation = async (server, userId, organisationId, organisation) => {
  return await server.inject({
    method: 'PUT',
    url: pathTo(paths.putOrganisation, { userId, organisationId }),
    headers: {
      'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
    },
    payload: {
      organisation
    }
  })
}

const initiatePayment = async (server, organisationId, organisationName, servicePeriodStart, servicePeriodEnd) => {
  return await server.inject({
    method: 'POST',
    headers: {
      'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
    },
    url: pathTo(paths.initiatePayment, { organisationId }),
    payload: {
      payment: {
        amount: 2134,
        description: 'SERVICE_CHARGE_DESCRIPTION',
        returnUrl: `http://example.com/paymentDetails`,
        metadata: { organisationId, organisationName, servicePeriodStart, servicePeriodEnd }
      }
    }
  })
}

const updatePayment = async (server, organisationId, paymentId, payload) => {
  return await server.inject({
    method: 'PUT',
    url: pathTo(paths.payment, { organisationId, paymentId }),
    headers: {
      'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
    },
    payload
  })
}

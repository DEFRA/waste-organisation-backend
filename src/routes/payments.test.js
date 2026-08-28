import { initialiseServer, WASTE_CLIENT_AUTH_TEST_TOKEN, stopServer } from '../common/helpers/initialse-test-server.js'
import { paths, pathTo } from '../config/paths.js'
import { orgCollection } from '../repositories/organisation.js'
import { isEnabled, updateDisableAfter } from '../domain/organisation.js'
import { paymentCollection } from '../repositories/payment.js'
import { faker } from '@faker-js/faker'

describe('payment API', () => {
  let server
  const wreckPostMock = vi.fn()
  const wreckGetMock = vi.fn()

  beforeAll(async () => {
    vi.clearAllMocks()
    vi.doMock('@hapi/wreck', () => ({
      default: {
        post: wreckPostMock.mockReturnValue({ payload: { post: 'response' } }),
        get: wreckGetMock.mockReturnValue({ payload: { get: 'response' } })
      }
    }))
    server = await initialiseServer()
  })

  afterAll(async () => {
    vi.clearAllMocks()
    stopServer(server)
  })

  test('get payment should respond with payment', async () => {
    const organisationId = faker.string.uuid()
    const paymentId = faker.string.uuid()
    const mockPayment = {
      organisationId,
      paymentId,
      status: 'pending'
    }
    await server.db.collection(paymentCollection).insertOne({ ...mockPayment })
    const { statusCode, payload } = await server.inject({
      method: 'GET',
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      url: pathTo(paths.payment, { organisationId, paymentId })
    })
    expect(JSON.parse(payload)).toEqual({
      message: 'success',
      payment: mockPayment
    })
    expect(statusCode).toEqual(200)
  })

  test('Should error if payment not found', async () => {
    const organisationId = faker.string.uuid()
    const paymentId = 'blahblah'
    const payment = fakeGovPayResponse(organisationId).payload
    const r = await updatePayment(server, organisationId, paymentId, { payment })
    expect(r.statusCode).toBe(404)
  })

  test('initiate payment', async () => {
    const organisationId = faker.string.uuid()
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
        idempotencyKey: expect.anything(),
        metadata: {
          organisationId,
          organisationName: 'organisation name',
          servicePeriodEnd: '2027-05-01T00:00:00Z',
          servicePeriodStart: '2026-05-01T00:00:00Z'
        },
        organisationId,
        paymentId: expect.anything(),
        reference: expect.anything(),
        returnUrl: 'http://example.com/paymentDetails',
        servicePeriodEnd: '2027-05-01T00:00:00.000Z',
        servicePeriodStart: '2026-05-01T00:00:00.000Z',
        status: 'payment_in_progress',
        updatedAt: expect.anything(),
        createdAt: expect.anything(),
        period: '2026/2027',
        version: 1
      }
    })
    expect(wreckPostMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        payload: expect.objectContaining({ language: 'en' })
      })
    )
  })

  test.each([
    { language: 'cy', expected: 'cy' },
    { language: 'CY', expected: 'cy' },
    { language: 'Cy', expected: 'cy' },
    { language: 'en', expected: 'en' },
    { language: 'fr', expected: 'en' },
    { language: '', expected: 'en' },
    { language: null, expected: 'en' },
    { language: 123, expected: 'en' }
  ])('initiate payment forwards language $language as $expected', async ({ language, expected }) => {
    const organisationId = faker.string.uuid()
    wreckPostMock.mockImplementation(async () => fakeGovPayResponse(organisationId))
    const { statusCode } = await initiatePayment(
      server,
      organisationId,
      'organisation name',
      '2026-05-01T00:00:00.000Z',
      '2027-05-01T00:00:00.000Z',
      language
    )
    expect(statusCode).toBe(200)
    expect(wreckPostMock.mock.calls.at(-1)[1].payload.language).toBe(expected)
  })

  test('initiate payment should reject non-matching org ids', async () => {
    const organisationId = faker.string.uuid()
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
    const organisationId = faker.string.uuid()
    wreckPostMock.mockImplementation(async () => {
      throw new Error('fish')
    })
    const { payload, statusCode } = await initiatePayment(server, organisationId, 'organisation name')
    expect(payload).toBe('{"message":"error","errors":[{"message":"error"}]}')
    expect(statusCode).toBe(200)
  })

  test('abandoned payment get closed', async () => {
    const organisationId = faker.string.uuid()
    wreckPostMock.mockImplementation(async () => {
      return fakeGovPayResponse(organisationId)
    })
    const organisation = updateDisableAfter({ organisationId, name: 'Weyland-Yutani Corporation' }, new Date('2026-05-01T00:00:00.000Z'))
    const r = await updateOrganisation(server, 'user123', organisationId, organisation)
    expect(isEnabled(JSON.parse(r.payload).organisation)).toBe(false)
    const r1 = await initiatePayment(server, organisationId, 'organisation name', '2026-05-01T00:00:00.000Z', '2027-05-01T00:00:00.000Z')
    expect(r1.statusCode).toBe(200)
    const { paymentId } = JSON.parse(r1.payload).payment

    const payment = fakeGovPayResponse(organisationId).payload
    payment.state.status = 'timedout'
    payment.state.finished = true
    const r2 = await updatePayment(server, organisationId, paymentId, { payment })

    expect(r2.statusCode).toBe(200)
    expect(JSON.parse(r2.payload).payment.status).toBe('payment_failed')
  })

  test('update payment with `success` enables org', async () => {
    const organisationId = faker.string.uuid()
    wreckPostMock.mockImplementation(async () => {
      return fakeGovPayResponse(organisationId)
    })
    const organisation = updateDisableAfter({ organisationId, name: 'Weyland-Yutani Corporation' }, new Date('2026-05-01T00:00:00.000Z'))
    const r = await updateOrganisation(server, 'user123', organisationId, organisation)
    expect(isEnabled(JSON.parse(r.payload).organisation)).toBe(false)
    const r1 = await initiatePayment(server, organisationId, 'organisation name', '2026-05-01T00:00:00.000Z', '2027-05-01T00:00:00.000Z')
    expect(r1.statusCode).toBe(200)
    const { paymentId } = JSON.parse(r1.payload).payment

    const payment = fakeGovPayResponse(organisationId).payload
    payment.state.status = 'success'
    payment.state.finished = true
    const r2 = await updatePayment(server, organisationId, paymentId, { payment })

    expect(r2.statusCode).toBe(200)
    const org = await server.db.collection(orgCollection).findOne({ organisationId: { $eq: organisationId } }, { projection: { _id: 0 } })
    expect(org.disableAfter).toEqual(new Date('2027-05-01T00:00:00.000Z'))
    expect(isEnabled(org, new Date('2026-11-11T00:00:00.000Z'))).toBe(true)
    expect(isEnabled(org, new Date('2027-11-11T00:00:00.000Z'))).toBe(false)
  })

  test('refund payment disables org', async () => {
    const organisationId = faker.string.uuid()
    wreckPostMock.mockImplementation(async () => {
      return fakeGovPayResponse(organisationId)
    })
    await updateOrganisation(server, 'user123', organisationId, { name: 'Weyland-Yutani Corporation' })
    const r1 = await initiatePayment(server, organisationId, 'organisation name', '2026-05-01T00:00:00.000Z', '2027-05-01T00:00:00.000Z')
    expect(r1.statusCode).toBe(200)
    const { paymentId } = JSON.parse(r1.payload).payment

    const payment = fakeGovPayResponse(organisationId).payload
    payment.state.status = 'success'
    payment.state.finished = true
    const r2 = await updatePayment(server, organisationId, paymentId, { payment })
    expect(r2.statusCode).toBe(200)
    const org2 = await server.db.collection(orgCollection).findOne({ organisationId: { $eq: organisationId } }, { projection: { _id: 0 } })
    expect(org2.disableAfter).toEqual(new Date('2027-05-01T00:00:00.000Z'))

    payment.refund_summary.amount_available = 0
    payment.refund_summary.amount_submitted = payment.amount
    const r3 = await updatePayment(server, organisationId, paymentId, { payment })
    expect(r3.statusCode).toBe(200)
    // expect(JSON.parse(r3.payload)).toEqual({})
    const org3 = await server.db.collection(orgCollection).findOne({ organisationId: { $eq: organisationId } }, { projection: { _id: 0 } })
    expect(org3.disableAfter).toEqual(new Date('2026-05-01T00:00:00.000Z'))
  })

  test('refund payment for last year does not disable org', async () => {
    const organisationId = faker.string.uuid()
    wreckPostMock.mockImplementation(async () => {
      return fakeGovPayResponse(organisationId)
    })

    const payFor = payForFn(server, organisationId)

    const payment = await payFor('2026-05-01T00:00:00.000Z', '2027-05-01T00:00:00.000Z', (payment) => {
      payment.state.status = 'success'
      payment.state.finished = true
      return payment
    })

    await payFor('2027-05-01T00:00:00.000Z', '2028-05-01T00:00:00.000Z', (payment) => {
      payment.state.status = 'success'
      payment.state.finished = true
      return payment
    })

    const org2 = await server.db.collection(orgCollection).findOne({ organisationId: { $eq: organisationId } }, { projection: { _id: 0 } })
    expect(org2.disableAfter).toEqual(new Date('2028-05-01T00:00:00.000Z'))

    payment.refund_summary.amount_available = 0
    payment.refund_summary.amount_submitted = payment.amount
    const r3 = await updatePayment(server, organisationId, payment.payment_id, { payment })
    expect(r3.statusCode).toBe(200)
    const org3 = await server.db.collection(orgCollection).findOne({ organisationId: { $eq: organisationId } }, { projection: { _id: 0 } })
    expect(org3.disableAfter).toEqual(new Date('2028-05-01T00:00:00.000Z'))
  })

  test('poll for status', async () => {
    const organisationId = faker.string.uuid()
    const paymentId = faker.string.uuid()
    wreckPostMock.mockImplementation(async () => {
      return fakeGovPayResponse(organisationId, paymentId)
    })
    const payFor = payForFn(server, organisationId)
    const payment = await payFor('2026-05-01T00:00:00.000Z', '2027-05-01T00:00:00.000Z', (payment) => {
      payment.state.status = 'success'
      payment.state.finished = true
      return payment
    })
    wreckGetMock.mockImplementation(async () => {
      payment.refund_summary.amount_available = 0
      payment.refund_summary.amount_submitted = payment.amount
      return { res: { statusCode: 200 }, payload: payment }
    })
    const { statusCode, payload } = await server.inject({
      method: 'POST',
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      url: pathTo(paths.payment, { organisationId, paymentId }),
      payload: {}
    })
    expect(statusCode).toEqual(200)
    expect(JSON.parse(payload).payment.status).toEqual('refund_succeeded')
  })

  test('poll for status should handle errors in gov pay', async () => {
    const organisationId = faker.string.uuid()
    const paymentId = faker.string.uuid()
    wreckPostMock.mockImplementation(async () => {
      return fakeGovPayResponse(organisationId, paymentId)
    })
    await updateOrganisation(server, 'user123', organisationId, { name: 'Weyland-Yutani Corporation' })
    const payFor = payForFn(server, organisationId)
    await payFor('2026-05-01T00:00:00.000Z', '2027-05-01T00:00:00.000Z', (payment) => {
      payment.state.status = 'success'
      payment.state.finished = true
      return payment
    })
    wreckGetMock.mockImplementation(async () => {
      throw new Error('fish')
    })
    const { statusCode, payload } = await server.inject({
      method: 'POST',
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      url: pathTo(paths.payment, { organisationId, paymentId }),
      payload: {}
    })
    expect(JSON.parse(payload).message).toBe('error')
    expect(statusCode).toBe(200)
  })

  test('second initiate is rejected', async () => {
    const organisationId = faker.string.uuid()
    const paymentId1 = faker.string.uuid()
    const paymentId2 = faker.string.uuid()

    const from = '2026-05-01T00:00:00.000Z'
    const to = '2027-05-01T00:00:00.000Z'

    let paymentCall = 0
    const fakePayments = [fakeGovPayResponse(organisationId, paymentId1), fakeGovPayResponse(organisationId, paymentId2)]
    wreckPostMock.mockImplementation(async () => {
      return fakePayments[paymentCall++]
    })
    await updateOrganisation(server, 'user123', organisationId, { name: 'Weyland-Yutani Corporation' })

    const r1 = await initiatePayment(server, organisationId, 'organisation name', from, to)
    expect(r1.statusCode).toBe(200)

    const r2 = await initiatePayment(server, organisationId, 'organisation name', from, to)

    expect(JSON.parse(r2.payload)).toEqual({
      message: 'duplicate payment',
      payment: { paymentId: expect.any(String) }
    })
  })
})

const payForFn = (server, organisationId) => async (from, to, paymentFn) => {
  const r1 = await initiatePayment(server, organisationId, 'organisation name', from, to)
  expect(r1.statusCode).toBe(200)
  const { paymentId } = JSON.parse(r1.payload).payment
  const payment = paymentFn(fakeGovPayResponse(organisationId, paymentId).payload)
  const r2 = await updatePayment(server, organisationId, paymentId, { payment })
  expect(r2.statusCode).toBe(200)
  return payment
}

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

const initiatePayment = async (server, organisationId, organisationName, servicePeriodStart, servicePeriodEnd, language) => {
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
        ...(language !== undefined ? { language } : {}),
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

const fakeGovPayResponse = (organisationId, paymentId) => ({
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
    payment_id: paymentId ?? faker.string.uuid(), //'hu20sqlact5260q2nanm0q8u93',
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

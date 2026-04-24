import { initialiseServer, WASTE_CLIENT_AUTH_TEST_TOKEN, stopServer } from '../common/helpers/initialse-test-server.js'
import { paths, pathTo } from '../config/paths.js'

describe('payment API', () => {
  let server

  beforeAll(async () => {
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
})

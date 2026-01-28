import {
  initialiseServer,
  WASTE_CLIENT_AUTH_TEST_TOKEN,
  stopServer
} from '../common/helpers/initialse-test-server.js'
import { paths, pathTo } from '../config/paths.js'

describe('api codes', () => {
  let server

  beforeAll(async () => {
    server = await initialiseServer()
  })

  afterAll(async () => {
    stopServer(server)
  })

  test('should list saved api codes', async () => {
    for (const apiCode of [
      {
        name: 'Alice',
        apiCode: 'abc123'
      },
      {
        name: 'Bob',
        disabled: 'true',
        apiCode: 'def456'
      }
    ]) {
      await server.inject({
        method: 'PUT',
        url: pathTo(paths.saveApiCode, {
          apiCode: apiCode.apiCode,
          organisationId: 456
        }),
        headers: {
          'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
        },
        payload: { apiCode }
      })
    }
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: pathTo(paths.listApiCodes, { organisationId: 456 }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      }
    })
    expect(result).toEqual({
      message: 'success',
      apiCodes: {
        abc123: {
          name: 'Alice',
          apiCode: 'abc123'
        },
        def456: {
          name: 'Bob',
          disabled: true,
          apiCode: 'def456'
        }
      }
    })
    expect(statusCode).toBe(200)
  })

  test('should PUT api code', async () => {
    const { result, statusCode } = await server.inject({
      method: 'PUT',
      url: pathTo(paths.saveApiCode, { apiCode: 123, organisationId: 456 }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      payload: {
        apiCode: {
          name: 'Bob'
        }
      }
    })

    expect(result).toEqual({
      message: 'success',
      apiCode: {
        name: 'Bob',
        apiCode: '123'
      }
    })
    expect(statusCode).toBe(200)
  })

  test('should disable api code', async () => {
    const { result, statusCode } = await server.inject({
      method: 'PUT',
      url: pathTo(paths.saveApiCode, { apiCode: 123, organisationId: 456 }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      payload: {
        apiCode: {
          name: 'Bob',
          disabled: 'true'
        }
      }
    })

    expect(result).toEqual({
      message: 'success',
      apiCode: {
        name: 'Bob',
        apiCode: '123',
        disabled: true
      }
    })
    expect(statusCode).toBe(200)
  })
})

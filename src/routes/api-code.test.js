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
        name: 'Alice'
      },
      {
        name: 'Bob'
      }
    ]) {
      const r = await server.inject({
        method: 'POST',
        url: pathTo(paths.createApiCode, {
          organisationId: 456
        }),
        headers: {
          'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
        },
        payload: { apiCode }
      })
      expect(r.statusCode).toBe(200)
    }
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: pathTo(paths.listApiCodes, { organisationId: 456 }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      }
    })
    expect(result.message).toEqual('success')
    expect(result.apiCodes[0].name).toEqual('Alice')
    expect(result.apiCodes[1].name).toEqual('Bob')
    expect(result.apiCodes[0].apiCode.toLowerCase()).toEqual(
      expect.stringMatching(/[0-9a-f-]*/)
    )
    expect(result.apiCodes[1].apiCode.toLowerCase()).toEqual(
      expect.stringMatching(/[0-9a-f-]*/)
    )
    expect(result.apiCodes[0].isDisabled).toEqual(false)
    expect(result.apiCodes[1].isDisabled).toEqual(false)
    expect(statusCode).toBe(200)
  })

  test('should PUT api code', async () => {
    const r = await server.inject({
      method: 'POST',
      url: pathTo(paths.createApiCode, {
        organisationId: 456
      }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      payload: {}
    })
    expect(r.statusCode).toBe(200)
    const apiCode = r.result.apiCode.apiCode
    expect(apiCode.toLowerCase()).toEqual(expect.stringMatching(/[0-9a-f-]*/))
    const { result, statusCode } = await server.inject({
      method: 'PUT',
      url: pathTo(paths.saveApiCode, { apiCode, organisationId: 456 }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      payload: {
        apiCode: {
          name: 'Bob'
        }
      }
    })

    expect(result.apiCode.name).toEqual('Bob')
    expect(statusCode).toBe(200)
  })

  test('should disable api code', async () => {
    const r = await server.inject({
      method: 'POST',
      url: pathTo(paths.createApiCode, {
        organisationId: 456
      }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      payload: {}
    })
    expect(r.statusCode).toBe(200)
    const apiCode = r.result.apiCode.apiCode
    expect(apiCode.toLowerCase()).toEqual(expect.stringMatching(/[0-9a-f-]*/))
    const { result, statusCode } = await server.inject({
      method: 'PUT',
      url: pathTo(paths.saveApiCode, { apiCode, organisationId: 456 }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      payload: {
        apiCode: {
          isDisabled: true
        }
      }
    })
    expect(result.apiCode.isDisabled).toEqual(true)
    expect(statusCode).toBe(200)
  })
  test('should disable api code', async () => {
    const r = await server.inject({
      method: 'POST',
      url: pathTo(paths.createApiCode, {
        organisationId: 456
      }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      payload: {}
    })
    expect(r.statusCode).toBe(200)
    const apiCode = r.result.apiCode.apiCode
    expect(apiCode.toLowerCase()).toEqual(expect.stringMatching(/[0-9a-f-]*/))
    const { statusCode } = await server.inject({
      method: 'PUT',
      url: pathTo(paths.saveApiCode, { apiCode, organisationId: 456 }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      payload: {
        apiCode: {
          isDisabled: 'fish'
        }
      }
    })
    expect(statusCode).toBe(200)
  })
})

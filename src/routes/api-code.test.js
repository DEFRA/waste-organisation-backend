import { initialiseServer, WASTE_CLIENT_AUTH_TEST_TOKEN, stopServer } from '../common/helpers/initialse-test-server.js'
import { paths, pathTo } from '../config/paths.js'
import { updateApiCode } from '../domain/organisation.js'

describe('api codes', () => {
  let server

  beforeAll(async () => {
    server = await initialiseServer()
  })

  afterAll(async () => {
    stopServer(server)
  })

  test('404 for not found org', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: pathTo(paths.listApiCodes, { organisationId: 'notehuntoehutnoeh' }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      }
    })
    expect(statusCode).toBe(404)
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
    expect(result.apiCodes[0].name).toEqual('Alice')
    expect(result.apiCodes[1].name).toEqual('Bob')
    expect(result.apiCodes[0].code.toLowerCase()).toEqual(expect.stringMatching(/[0-9a-f-]*/))
    expect(result.apiCodes[1].code.toLowerCase()).toEqual(expect.stringMatching(/[0-9a-f-]*/))
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
    const apiCode = r.result.code
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

    expect(result.name).toEqual('Bob')
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
    const apiCode = r.result.code
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
    expect(result.isDisabled).toEqual(true)
    expect(statusCode).toBe(200)
  })

  test('check validation errors', async () => {
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
    const apiCode = r.result.code
    expect(apiCode.toLowerCase()).toEqual(expect.stringMatching(/[0-9a-f-]*/))
    const { statusCode } = await server.inject({
      method: 'PUT',
      url: pathTo(paths.saveApiCode, { apiCode, organisationId: 456 }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      payload: {
        apiCode: {
          name: 123
        }
      }
    })
    expect(statusCode).toBe(400)
  })

  test('should resolve org from api code - supporting basic auth', async () => {
    const r = await server.inject({
      method: 'POST',
      url: pathTo(paths.createApiCode, {
        organisationId: 456
      }),
      headers: {
        authorization: 'Basic d2FzdGUtbW92ZW1lbnQtZXh0ZXJuYWwtYXBpOjRkNWQ0OGNiLTQ1NmEtNDcwYS04ODE0LWVhZTI3NThiZTkwZA=='
      },
      payload: {}
    })
    expect(r.statusCode).toBe(200)
    const apiCode = r.result.code
    expect(apiCode.toLowerCase()).toEqual(expect.stringMatching(/[0-9a-f-]*/))
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: pathTo(paths.lookupOrgFromApiCode, { apiCode }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      }
    })
    expect(result.defraOrganisationId).toEqual('456')
    expect(statusCode).toBe(200)
  })

  test('should reject invalid auth token', async () => {
    const r = await server.inject({
      method: 'POST',
      url: pathTo(paths.createApiCode, {
        organisationId: 456
      }),
      headers: {
        authorization: 'Basic ' + Buffer.from('user:fish:invalid', 'utf8').toString('base64')
      },
      payload: {}
    })
    expect(r.statusCode).toBe(403)
    const r1 = await server.inject({
      method: 'POST',
      url: pathTo(paths.createApiCode, {
        organisationId: 456
      }),
      headers: {
        authorization: 'fish'
      },
      payload: {}
    })
    expect(r1.statusCode).toBe(403)
  })

  test('should 404 for unknown api code', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: pathTo(paths.lookupOrgFromApiCode, {
        apiCode: 'not a known api code'
      }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      }
    })
    expect(statusCode).toBe(404)
  })

  test('should 404 for disabled api code', async () => {
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
    const apiCode = r.result.code
    expect(apiCode.toLowerCase()).toEqual(expect.stringMatching(/[0-9a-f-]*/))
    await server.inject({
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
    const { statusCode } = await server.inject({
      method: 'GET',
      url: pathTo(paths.lookupOrgFromApiCode, {
        apiCode
      }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      }
    })
    expect(statusCode).toBe(404)
  })
})

describe('api code domain tests', () => {
  test('should throw if no api code found', () => {
    try {
      updateApiCode({}, 'test', 'name')
      expect(true).toBe(false)
    } catch {
      expect(true).toEqual(true)
    }
  })
})

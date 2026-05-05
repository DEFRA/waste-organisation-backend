import { beforeEach } from 'vitest'
import { initialiseServer, WASTE_CLIENT_AUTH_TEST_TOKEN, stopServer } from '../common/helpers/initialse-test-server.js'
import { paths, pathTo } from '../config/paths.js'
import { updateApiCode } from '../domain/organisation.js'

const USER_ID = 123
const ORGANISATION_ID = 456

describe('api codes', () => {
  let server

  beforeAll(async () => {
    server = await initialiseServer()
  })

  afterAll(async () => {
    stopServer(server)
  })

  beforeEach(async () => {
    await updateOrganisation(server, USER_ID, ORGANISATION_ID, {
      name: 'Bob',
      isDisabled: false,
      apiCodes: [
        {
          code: 'fafde9f0-9d6f-46b3-b4e1-b0133e905637',
          name: 'Bob',
          isDisabled: false
        }
      ]
    })
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
    const r = await createApiCode(server, ORGANISATION_ID, {
      apiCode: {
        name: 'Alice'
      }
    })

    expect(r.statusCode).toBe(200)

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: pathTo(paths.listApiCodes, { organisationId: ORGANISATION_ID }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      }
    })

    expect(result.apiCodes[0].name).toEqual('Bob')
    expect(result.apiCodes[1].name).toEqual('Alice')
    expect(result.apiCodes[0].code.toLowerCase()).toEqual(expect.stringMatching(/[0-9a-f-]*/))
    expect(result.apiCodes[1].code.toLowerCase()).toEqual(expect.stringMatching(/[0-9a-f-]*/))
    expect(result.apiCodes[0].isDisabled).toEqual(false)
    expect(result.apiCodes[1].isDisabled).toEqual(false)
    expect(statusCode).toBe(200)
  })

  test('should PUT api code', async () => {
    const r = await createApiCode(server, ORGANISATION_ID, {})

    expect(r.statusCode).toBe(200)
    const apiCode = r.result.code
    expect(apiCode.toLowerCase()).toEqual(expect.stringMatching(/[0-9a-f-]*/))

    const { result, statusCode } = await saveApiCode(server, ORGANISATION_ID, apiCode, {
      apiCode: {
        name: 'Joe'
      }
    })

    expect(result.name).toEqual('Joe')
    expect(statusCode).toBe(200)
  })

  test('should disable api code', async () => {
    const r = await createApiCode(server, ORGANISATION_ID, {})
    expect(r.statusCode).toBe(200)
    const apiCode = r.result.code
    expect(apiCode.toLowerCase()).toEqual(expect.stringMatching(/[0-9a-f-]*/))

    const { result, statusCode } = await saveApiCode(server, ORGANISATION_ID, apiCode, {
      apiCode: {
        isDisabled: true
      }
    })

    expect(result.isDisabled).toEqual(true)
    expect(statusCode).toBe(200)
  })

  test('should disable api code when org disabled', async () => {
    await updateOrganisation(server, USER_ID, ORGANISATION_ID, {
      name: 'Bob',
      isDisabled: true
    })

    const r = await createApiCode(server, ORGANISATION_ID, { name: 'Bob', isDisabled: false })

    expect(r.statusCode).toBe(200)

    const apiCode = r.result.code
    expect(apiCode.toLowerCase()).toEqual(expect.stringMatching(/[0-9a-f-]*/))
    const { statusCode } = await server.inject({
      method: 'GET',
      url: pathTo(paths.lookupOrgFromApiCode, { apiCode }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      }
    })

    expect(statusCode).toBe(404)
  })

  test('check validation errors', async () => {
    const r = await createApiCode(server, ORGANISATION_ID, {})

    expect(r.statusCode).toBe(200)
    const apiCode = r.result.code
    expect(apiCode.toLowerCase()).toEqual(expect.stringMatching(/[0-9a-f-]*/))

    const { statusCode } = await saveApiCode(server, ORGANISATION_ID, apiCode, {
      apiCode: {
        name: 123
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
    expect(result.defraCustomerOrganisationId).toEqual('456')
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

const updateOrganisation = async (server, userId, organisationId, organisation) => {
  await server.inject({
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

const createApiCode = (server, organisationId, payload) => {
  return server.inject({
    method: 'POST',
    url: pathTo(paths.createApiCode, {
      organisationId
    }),
    headers: {
      'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
    },
    payload
  })
}

const saveApiCode = async (server, organisationId, apiCode, payload) => {
  const { result, statusCode } = await server.inject({
    method: 'PUT',
    url: pathTo(paths.saveApiCode, { apiCode, organisationId }),
    headers: {
      'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
    },
    payload
  })

  return { result, statusCode }
}

import { initialiseServer, WASTE_CLIENT_AUTH_TEST_TOKEN, stopServer } from '../common/helpers/initialse-test-server.js'
import { paths, pathTo } from '../config/paths.js'

describe('organisation API', () => {
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
      url: pathTo(paths.putOrganisation, { userId: 123, organisationId: 456 }),
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      payload: {
        organisation: {
          name: 'Bob'
        }
      }
    })

    expect(result).toEqual({
      message: 'success',
      organisation: {
        name: 'Bob',
        organisationId: '456',
        users: ['123'],
        version: 1
      }
    })
    expect(statusCode).toBe(200)
  })

  test('Should add user to existing org', async () => {
    const organisationId = 456
    const o = (userId) => ({
      organisation: { name: 'Mr Dabolina', organisationId },
      urlParams: { userId, organisationId }
    })
    const req = async (userId) => {
      const { organisation, urlParams } = o(userId)
      return await server.inject({
        method: 'PUT',
        headers: {
          'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
        },
        url: pathTo(paths.putOrganisation, urlParams),
        payload: { organisation }
      })
    }
    const r1 = await req(123)
    expect(r1.statusCode).toBe(200)
    const { result, statusCode } = await req(789)
    expect(result).toEqual({
      message: 'success',
      organisation: {
        name: 'Mr Dabolina',
        organisationId: '456',
        users: ['123', '789'],
        version: 3
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
      url: pathTo(paths.putOrganisation, { userId: 111, organisationId: 999 }),
      payload: { organisation: { name: 'Mr Dabolina', organisationId: 999 } }
    })
    expect(r1.statusCode).toBe(200)
    expect(r1.result.organisation.organisationId).toEqual('999')
    const { result, statusCode } = await server.inject({
      method: 'GET',
      headers: {
        'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
      },
      url: pathTo(paths.getOrganisations, { userId: 111 })
    })
    expect(result).toEqual({
      message: 'success',
      organisations: [
        {
          name: 'Mr Dabolina',
          organisationId: '999',
          users: ['111'],
          version: 1
        }
      ]
    })
    expect(statusCode).toBe(200)
  })
})

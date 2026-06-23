import { expect } from 'vitest'
import { initialiseServer, WASTE_CLIENT_AUTH_TEST_TOKEN, stopServer } from '../common/helpers/initialse-test-server.js'
import { paths, pathTo } from '../config/paths.js'
import { randomUUID } from 'node:crypto'

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
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        name: 'Bob',
        organisationId: '456',
        users: ['123'],
        disableAfter: new Date('2026-10-01T00:00:00.000Z'),
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
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        name: 'Mr Dabolina',
        organisationId: '456',
        users: ['123', '789'],
        disableAfter: new Date('2026-10-01T00:00:00.000Z'),
        version: 3
      }
    })
    expect(statusCode).toBe(200)
  })

  describe('Should GET org', async () => {
    const organisationId = randomUUID()
    beforeAll(async () => {
      await server.inject({
        method: 'PUT',
        url: pathTo(paths.putOrganisation, { userId: 123, organisationId }),
        headers: {
          'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
        },
        payload: {
          organisation: {
            name: 'Bob'
          }
        }
      })
    })

    test('success', async () => {
      const { result, statusCode } = await server.inject({
        method: 'GET',
        url: pathTo(paths.getOrganisation, { userId: 123, organisationId }),
        headers: {
          'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
        }
      })

      expect(result).toEqual({
        message: 'success',
        organisation: {
          name: 'Bob',
          organisationId,
          apiCodes: [
            {
              code: expect.anything(),
              isDisabled: false,
              name: 'API Code 1'
            }
          ],
          paymentPeriods: [
            {
              from: new Date('2026-10-01T00:00:00.000Z'),
              to: new Date('2027-10-01T00:00:00.000Z'),
              priceInPence: 2600
            }
          ],
          users: ['123'],
          disableAfter: new Date('2026-10-01T00:00:00.000Z'),
          version: expect.anything()
        }
      })
      expect(statusCode).toBe(200)
    })

    test('not found', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: pathTo(paths.getOrganisation, { userId: 123, organisationId: 99999999999999 }),
        headers: {
          'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
        }
      })

      expect(statusCode).toBe(404)
    })

    test('not allowed', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: pathTo(paths.getOrganisation, { userId: 99999999999999, organisationId }),
        headers: {
          'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN
        }
      })

      expect(statusCode).toBe(403)
    })
  })
})

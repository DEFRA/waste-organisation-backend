import { expect } from 'vitest'
import { initialiseServer, WASTE_CLIENT_AUTH_TEST_TOKEN, stopServer } from '../common/helpers/initialse-test-server.js'
import { paths, pathTo } from '../config/paths.js'
import { orgCollection } from '../repositories/organisation.js'
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
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
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

  describe('GET organisations by registration date range', () => {
    const getByDateRange = (query) =>
      server.inject({
        method: 'GET',
        url: `${paths.getOrganisationsByDateRange}?${new URLSearchParams(query).toString()}`,
        headers: { 'x-auth-token': WASTE_CLIENT_AUTH_TEST_TOKEN }
      })

    // org-0002 and org-0003 share the same registration timestamp to exercise the orgId tie-break
    const sameDay = new Date('2025-01-20T09:00:00.000Z')
    const apiCode = (code, isDisabled = false) => ({ code, name: code, isDisabled })
    const seededOrgs = [
      { organisationId: 'org-0001', createdAt: new Date('2025-01-10T09:00:00.000Z'), apiCodes: [apiCode('dr-c1'), apiCode('dr-c2')] },
      { organisationId: 'org-0002', createdAt: sameDay, apiCodes: [apiCode('dr-c3'), apiCode('dr-c4', true)] },
      { organisationId: 'org-0003', createdAt: sameDay, apiCodes: [apiCode('dr-c5', true)] },
      // org-0004 mixes an enabled code with codes whose isDisabled is null / absent, which are not "active"
      {
        organisationId: 'org-0004',
        createdAt: new Date('2025-03-15T09:00:00.000Z'),
        apiCodes: [apiCode('dr-c7'), { code: 'dr-c8', name: 'dr-c8', isDisabled: null }, { code: 'dr-c9', name: 'dr-c9' }]
      },
      { organisationId: 'org-9999', createdAt: new Date('2025-06-01T09:00:00.000Z'), apiCodes: [apiCode('dr-c6')] }
    ]

    beforeAll(async () => {
      await server.db.collection(orgCollection).insertMany(seededOrgs.map((o) => ({ ...o })))
    })

    test('returns active API code counts, sorted by date then orgId descending, excluding out-of-range orgs', async () => {
      const { result, statusCode } = await getByDateRange({ startDate: '2025-01-01', endDate: '2025-01-31' })

      expect(statusCode).toBe(200)
      expect(result).toEqual([
        { organisationId: 'org-0003', dateRegistered: sameDay, activeApiCodeCount: 0 },
        { organisationId: 'org-0002', dateRegistered: sameDay, activeApiCodeCount: 1 },
        { organisationId: 'org-0001', dateRegistered: new Date('2025-01-10T09:00:00.000Z'), activeApiCodeCount: 2 }
      ])
    })

    test('counts only explicitly enabled API codes, treating null/absent isDisabled as inactive', async () => {
      const { result, statusCode } = await getByDateRange({ startDate: '2025-03-01', endDate: '2025-03-31' })

      expect(statusCode).toBe(200)
      expect(result).toEqual([{ organisationId: 'org-0004', dateRegistered: new Date('2025-03-15T09:00:00.000Z'), activeApiCodeCount: 1 }])
    })

    test('accepts the same start and end date, returning orgs registered that day (00:00:00 to 23:59:59 UTC)', async () => {
      const { result, statusCode } = await getByDateRange({ startDate: '2025-01-20', endDate: '2025-01-20' })

      expect(statusCode).toBe(200)
      expect(result).toEqual([
        { organisationId: 'org-0003', dateRegistered: sameDay, activeApiCodeCount: 0 },
        { organisationId: 'org-0002', dateRegistered: sameDay, activeApiCodeCount: 1 }
      ])
    })

    test('endDate is inclusive of the whole day', async () => {
      const { result, statusCode } = await getByDateRange({ startDate: '2025-01-15', endDate: '2025-01-20' })

      expect(statusCode).toBe(200)
      expect(result.map((o) => o.organisationId)).toEqual(['org-0003', 'org-0002'])
    })

    test('returns an empty array when no organisations registered in range', async () => {
      const { result, statusCode } = await getByDateRange({ startDate: '2024-01-01', endDate: '2024-12-31' })

      expect(statusCode).toBe(200)
      expect(result).toEqual([])
    })

    test.each([
      ['missing startDate', { endDate: '2025-01-31' }],
      ['missing endDate', { startDate: '2025-01-01' }],
      ['endDate before startDate', { startDate: '2025-02-01', endDate: '2025-01-01' }],
      ['invalid date', { startDate: 'not-a-date', endDate: '2025-01-31' }]
    ])('rejects %s with 400', async (_label, query) => {
      const { statusCode } = await getByDateRange(query)
      expect(statusCode).toBe(400)
    })

    test('createdAt index exists to support the date-range query', async () => {
      const indexes = await server.db.collection(orgCollection).indexes()
      expect(indexes.some((index) => index.key?.createdAt === -1)).toBe(true)
    })
  })
})

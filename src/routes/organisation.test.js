import { initialiseServer } from '../common/helpers/initialse-test-server.js'
import { paths, pathTo } from '../config/paths.js'
import * as mockMongo from 'vitest-mongodb'
import { orgSchema, mergeParams } from './organisation.js'

describe('organisation API', () => {
  let server

  beforeAll(async () => {
    // TODO inject a mock db - currently relies on mongo being up
    await mockMongo.setup()
    server = await initialiseServer()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
    await mockMongo.teardown()
  })

  test.each([
    {
      name: 'Bob'
    },
    {
      isWasteReceiver: true
    },
    {
      isWasteReceiver: false,
      users: ['abc']
    }
  ])('validate', (org) => {
    const { error, value } = orgSchema.validate(
      mergeParams(null, org, '456', '123')
    )
    expect(error).toEqual(undefined)
    expect(value.name).toEqual(org.name)
  })

  test('Should PUT org', async () => {
    const { result, statusCode } = await server.inject({
      method: 'PUT',
      url: pathTo(paths.putOrganisation, { userId: 123, organisationId: 456 }),
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
        users: ['123']
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
        users: ['123', '789']
      }
    })
    expect(statusCode).toBe(200)
  })
})

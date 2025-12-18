import {
  mergeAndValidate,
  removeUserConnection
} from '../domain/organisation.js'

const testData = [
  {
    org: {
      name: 'Bob'
    }
  },
  {
    org: {
      isWasteReceiver: true
    }
  },
  {
    org: {
      isWasteReceiver: false,
      users: ['abc']
    }
  },
  {
    db: {
      users: []
    },
    org: {
      users: ['abc'],
      connections: { 'abc-123': 'abc' }
    }
  }
]

describe('user domain', () => {
  test.each(testData)('validate', ({ db, org, orgId, userId }) => {
    const u = userId || '123'
    const o = orgId || '456'
    const { error, organisation } = mergeAndValidate(db, org, o, u)

    expect(error).toBe(undefined)
    expect(organisation.name).toEqual(org.name)
    expect(organisation.organisationId).toEqual(o)
    expect(organisation.users.includes(u)).toBe(true)
    if (organisation.connections) {
      const uids = new Set(Object.values(organisation.connections))
      uids.add(u)
      expect(uids).toEqual(new Set(organisation.users))
    }
  })

  test('remove event', () => {
    const org = removeUserConnection(
      {
        users: ['xyz', 'abc'],
        connections: { 'abc-123': 'abc', 'xyz-789': 'xyz' }
      },
      'abc-123'
    )
    expect(org.connections).toEqual({ 'xyz-789': 'xyz' })
    expect(org.users).toEqual(['xyz'])
  })
})

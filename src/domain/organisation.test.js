import { mergeAndValidate } from '../domain/organisation.js'

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
  }
]

test.each(testData)('validate', ({ db, org, orgId, userId }) => {
  const u = userId || '123'
  const o = orgId || '456'
  const { error, organisation } = mergeAndValidate(db, org, o, u)

  expect(error).toEqual(undefined)
  expect(organisation.name).toEqual(org.name)
  expect(organisation.organisationId).toEqual(o)
  expect(organisation.users.includes(u)).toBe(true)
})

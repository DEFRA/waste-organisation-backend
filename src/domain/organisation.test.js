import { mergeAndValidate, disableOrg, enableOrg } from './organisation.js'

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

describe('organisation domain', () => {
  test.each(testData)('validate', ({ db, org, orgId, userId }) => {
    const u = userId || '123'
    const o = orgId || '456'
    const organisation = mergeAndValidate(db, org, o, u)

    expect(organisation.name).toEqual(org.name)
    expect(organisation.organisationId).toEqual(o)
    expect(organisation.users.includes(u)).toBe(true)
  })

  test('enable/disable', () => {
    const org = { org: { name: 'Bob' } }
    const disabledOrg = disableOrg(org, 'testing')
    expect(disabledOrg.isDisabled).toBe(true)
    const enabledOrg = enableOrg(org)
    expect(enabledOrg.isDisabled).toBe(false)
    expect(disableOrg(enabledOrg).isDisabled).toBe(true)
  })
})

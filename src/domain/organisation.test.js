import { mergeAndValidate, disableOrg, enableOrg, isEnabled, updateDisableAfter } from './organisation.js'

const ORANISATION_ID = 'organisationid123'
const ORANISATION_NAME = 'Bob'

const testOrganisation = { organisationId: ORANISATION_ID, name: ORANISATION_NAME }

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
    const org = testOrganisation
    const disabledOrg = disableOrg(org, 'testing')
    expect(disabledOrg.isDisabled).toBe(true)
    expect(disabledOrg.disabledReason).toBe('testing')
    const enabledOrg = enableOrg(org)
    expect(enabledOrg.isDisabled).toBe(false)
    expect(enabledOrg.disabledReason).toBe(null)
    expect(disableOrg(enabledOrg).isDisabled).toBe(true)
  })
})

describe('org is enabled', () => {
  test('boolean flag missing', () => {
    expect(isEnabled({})).toBe(true)
  })
  test('boolean flag enabled', () => {
    expect(isEnabled({ isDisabled: false })).toBe(true)
  })
  test('boolean flag disabled', () => {
    expect(isEnabled({ isDisabled: true })).toBe(false)
  })
  test('disable date in the future is enabled', () => {
    expect(isEnabled({ disableAfter: new Date('2026-05-13T00:00:00Z') }, new Date('2026-01-01T00:00:00Z'))).toBe(true)
  })
  test('disable date in the past is disabled', () => {
    expect(isEnabled({ disableAfter: new Date('2026-01-01T00:00:00Z') }, new Date('2026-05-13T00:00:00Z'))).toBe(false)
  })
  test('disabled flag trumps disable date in the future', () => {
    expect(isEnabled({ isDisabled: true, disableAfter: new Date('2026-05-13T00:00:00Z') }, new Date('2026-01-01T00:00:00Z'))).toBe(false)
  })
  test('disable date in the past trumps disabled flag set to false', () => {
    expect(isEnabled({ isDisabled: false, disableAfter: new Date('2026-01-01T00:00:00Z') }, new Date('2026-05-13T00:00:00Z'))).toBe(false)
  })
  test('at defaults to now', () => {
    expect(isEnabled({ isDisabled: false, disableAfter: new Date('2026-01-01T00:00:00Z') })).toBe(false)
  })
  test('null org is disaled', () => {
    expect(isEnabled(null)).toBe(true)
  })
})

describe('update disable after', () => {
  test('set when null', () => {
    expect(updateDisableAfter(testOrganisation, new Date('2026-01-01T00:00:00Z'))).toEqual({
      ...testOrganisation,
      disableAfter: new Date('2026-01-01T00:00:00Z')
    })
  })
  test('update to newer time', () => {
    expect(updateDisableAfter({ ...testOrganisation, disableAfter: new Date('2026-01-01T00:00:00Z') }, new Date('2027-01-01T00:00:00Z'))).toEqual({
      ...testOrganisation,
      disableAfter: new Date('2027-01-01T00:00:00Z')
    })
  })
  test('ignore older time', () => {
    expect(updateDisableAfter({ ...testOrganisation, disableAfter: new Date('2027-01-01T00:00:00Z') }, new Date('2024-01-01T00:00:00Z'))).toEqual({
      ...testOrganisation,
      disableAfter: new Date('2027-01-01T00:00:00Z')
    })
  })
})

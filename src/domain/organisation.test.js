import {
  mergeAndValidate,
  disableOrg,
  enableOrg,
  isEnabled,
  updateDisableAfter,
  calculateNextPaymentPeriod,
  updateOrganisationPaymentStatus
} from './organisation.js'
import { config } from '../config.js'
import { faker } from '@faker-js/faker'

const ORANISATION_ID = 'organisationid123'
const ORANISATION_NAME = 'Bob'

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
    const org = createOrganisation()
    const disabledOrg = disableOrg(org, 'testing')
    expect(disabledOrg.isDisabled).toBe(true)
    expect(disabledOrg.disabledReason).toBe('testing')
    const enabledOrg = enableOrg(org)
    expect(enabledOrg.isDisabled).toBe(false)
    expect(enabledOrg.disabledReason).toBe(null)
    expect(disableOrg(enabledOrg).isDisabled).toBe(true)
  })

  test('mergeAndValidate keeps disableAfter null when missing', () => {
    const organisation = mergeAndValidate(null, { name: ORANISATION_NAME }, ORANISATION_ID, 'user-1')
    expect(organisation.disableAfter).toBe(null)
  })
})

describe('org is enabled', () => {
  const configDate = config.get('govPay.serviceChargeFreePeriodEnd')
  beforeEach(() => {
    config.set('govPay.serviceChargeFreePeriodEnd', new Date('2000-10-01T00:00:00.000Z'))
  })
  afterAll(() => {
    config.set('govPay.serviceChargeFreePeriodEnd', configDate)
  })

  test('boolean flag missing, in free period', () => {
    expect(isEnabled({}, new Date('1999-01-01T00:00:00.000Z'))).toBe(true)
  })
  test('boolean flag missing, after free period', () => {
    expect(isEnabled({}, new Date('2001-01-01T00:00:00.000Z'))).toBe(false)
  })
  test('boolean flag enabled, in free period', () => {
    expect(isEnabled({ isDisabled: false }, new Date('1999-01-01T00:00:00.000Z'))).toBe(true)
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
    const organisation = createOrganisation()
    const nextDate = addYears(new Date(), 2)

    expect(updateDisableAfter(organisation, nextDate)).toEqual({
      ...organisation,
      apiCodes: [expect.anything()],
      disableAfter: nextDate
    })
  })
  test('update to newer time', () => {
    const organisation = createOrganisation()
    expect(updateDisableAfter({ ...organisation, disableAfter: new Date('2026-01-01T00:00:00Z') }, new Date('2027-01-01T00:00:00Z'))).toEqual({
      ...organisation,
      apiCodes: [expect.anything()],
      disableAfter: new Date('2027-01-01T00:00:00Z')
    })
  })
  test('ignore older time', () => {
    const organisation = createOrganisation()
    expect(updateDisableAfter({ ...organisation, disableAfter: new Date('2027-01-01T00:00:00Z') }, new Date('2024-01-01T00:00:00Z'))).toEqual({
      ...organisation,
      apiCodes: [expect.anything()],
      disableAfter: new Date('2027-01-01T00:00:00Z')
    })
  })
})

describe('calculate payment period', () => {
  const configDate = config.get('govPay.serviceChargeFreePeriodEnd')
  const configStart = config.get('govPay.serviceChargePaymentWindowStart')
  const configPrice = config.get('govPay.serviceChargeAmountPence')

  const october25 = new Date('2025-10-01T00:00:00.000Z')
  const october26 = new Date('2026-10-01T00:00:00.000Z')
  const october27 = new Date('2027-10-01T00:00:00.000Z')
  const may26 = new Date('2026-05-15T14:33:07.718Z')
  const march26 = new Date('2026-03-15T14:33:07.718Z')
  const november26 = new Date('2026-11-15T14:33:07.718Z')
  const may27 = new Date('2027-05-15T14:33:07.718Z')
  const testOrganisation = { organisationId: ORANISATION_ID, name: ORANISATION_NAME }

  beforeEach(() => {
    config.set('govPay.serviceChargeFreePeriodEnd', new Date('1991-10-01T00:00:00.000Z'))
    config.set('govPay.serviceChargePaymentWindowStart', '1-4') // first of April
    config.set('govPay.serviceChargeAmountPence', 100)
  })
  afterAll(() => {
    config.set('govPay.serviceChargeFreePeriodEnd', configDate)
    config.set('govPay.serviceChargePaymentWindowStart', configStart)
    config.set('govPay.serviceChargeAmountPence', configPrice)
  })

  test('no initial data, during free period', () => {
    config.set('govPay.serviceChargeFreePeriodEnd', october26)
    expect(calculateNextPaymentPeriod(testOrganisation, may26).paymentPeriods).toEqual([{ from: october26, to: october27, priceInPence: 100 }])
  })

  test('no initial data, payment window open', () => {
    expect(calculateNextPaymentPeriod(testOrganisation, may26).paymentPeriods).toEqual([{ from: october25, to: october26, priceInPence: 100 }])
  })

  test('no initial data, payment window closed', () => {
    expect(calculateNextPaymentPeriod(testOrganisation, march26).paymentPeriods).toEqual([{ from: october25, to: october26, priceInPence: 100 }])
  })

  test('no initial data, payment window closed after the period rollover', () => {
    expect(calculateNextPaymentPeriod(testOrganisation, november26).paymentPeriods).toEqual([{ from: october26, to: october27, priceInPence: 100 }])
  })

  test('paid for last year, payment window open', () => {
    expect(calculateNextPaymentPeriod(updateDisableAfter(testOrganisation, october26), may27).paymentPeriods).toEqual([
      { from: october26, to: october27, priceInPence: 100 }
    ])
  })

  test('paid for current year, payment window open', () => {
    expect(calculateNextPaymentPeriod(updateDisableAfter(testOrganisation, october26), may26).paymentPeriods).toEqual([
      { from: october26, to: october27, priceInPence: 100 }
    ])
  })

  test('paid for next year, payment window open', () => {
    config.set('govPay.serviceChargeFreePeriodEnd', new Date('2025-10-01T00:00:00.000Z'))
    expect(calculateNextPaymentPeriod(updateDisableAfter(testOrganisation, october27), may26).paymentPeriods).toEqual([])
  })

  test('paid for current year, payment window closed', () => {
    expect(calculateNextPaymentPeriod(updateDisableAfter(testOrganisation, october26), march26).paymentPeriods).toEqual([])
  })

  test('paid for last year, payment window closed', () => {
    expect(calculateNextPaymentPeriod(updateDisableAfter(testOrganisation, october26), november26).paymentPeriods).toEqual([
      { from: october26, to: october27, priceInPence: 100 }
    ])
  })

  test('paid for some time way in the past, payment window closed', () => {
    expect(calculateNextPaymentPeriod(updateDisableAfter(testOrganisation, new Date('1991-10-01T00:00:00.000Z')), november26).paymentPeriods).toEqual([
      { from: october26, to: october27, priceInPence: 100 }
    ])
  })

  test('paid for some time way in the past, payment window open', () => {
    expect(calculateNextPaymentPeriod(updateDisableAfter(testOrganisation, new Date('1991-10-01T00:00:00.000Z')), may26).paymentPeriods).toEqual([
      { from: october25, to: october26, priceInPence: 100 }
    ])
  })

  test('config validator throws on invalid data', () => {
    expect(() => config.set('govPay.serviceChargeFreePeriodEnd', 'boeucoeru')).toThrow(/must be a valid date string/)
  })

  test('overlapping years, not paid yet', () => {
    config.set('govPay.serviceChargePaymentWindowStart', '1-11') // first of Nov
    config.set('govPay.serviceChargeFreePeriodEnd', new Date('1991-01-01T00:00:00.000Z'))
    const now = new Date('1990-11-11T00:00:00.000Z')
    expect(calculateNextPaymentPeriod(testOrganisation, now).paymentPeriods).toEqual([
      { from: new Date('1991-01-01T00:00:00.000Z'), to: new Date('1992-01-01T00:00:00.000Z'), priceInPence: 100 }
    ])
  })

  test('overlapping years and has paid for last year', () => {
    config.set('govPay.serviceChargePaymentWindowStart', '1-11') // first of Nov
    config.set('govPay.serviceChargeFreePeriodEnd', new Date('1989-01-01T00:00:00.000Z'))
    const now = new Date('1990-11-11T00:00:00.000Z')
    const paidUpTo = new Date('1990-01-01T00:00:00.000Z')
    expect(calculateNextPaymentPeriod(updateDisableAfter(testOrganisation, paidUpTo), now).paymentPeriods).toEqual([
      { from: new Date('1990-01-01T00:00:00.000Z'), to: new Date('1991-01-01T00:00:00.000Z'), priceInPence: 100 }
    ])
  })

  test(`You can always pay during the free period`, () => {
    config.set('govPay.serviceChargePaymentWindowStart', '07-01')
    config.set('govPay.serviceChargeFreePeriodEnd', new Date('2027-01-30T00:00:00.000Z'))
    const now = new Date('2026-08-20T11:18:48.417Z')
    expect(calculateNextPaymentPeriod(testOrganisation, now).paymentPeriods).toEqual([
      { priceInPence: 100, from: new Date('2027-01-30T00:00:00.000Z'), to: new Date('2028-01-30T00:00:00.000Z') }
    ])
    const then = new Date('2027-08-20T11:18:48.417Z')
    expect(calculateNextPaymentPeriod(updateDisableAfter(testOrganisation, new Date('2028-01-30T00:00:00.000Z')), then).paymentPeriods).toEqual([])
  })

  test('moving the end of the free period does not affect people that have already paid', () => {
    config.set('govPay.serviceChargePaymentWindowStart', '1-4') // first of April
    config.set('govPay.serviceChargeFreePeriodEnd', new Date('1991-10-01T00:00:00.000Z'))
    const paymentDate = new Date('1991-11-11T00:00:00.000Z')
    const pp = calculateNextPaymentPeriod(testOrganisation, paymentDate)
    const org = updateDisableAfter(testOrganisation, pp.paymentPeriods[0].to)

    config.set('govPay.serviceChargePaymentWindowStart', '1-12') // first of Dec
    config.set('govPay.serviceChargeFreePeriodEnd', new Date('1992-01-31T00:00:00.000Z'))
    const now = new Date('1992-09-25T00:00:00.000Z')
    expect(calculateNextPaymentPeriod(org, now).paymentPeriods).toEqual([
      { from: new Date('1992-10-01T00:00:00.000Z'), to: new Date('1993-10-01T00:00:00.000Z'), priceInPence: 100 }
    ])
  })
})

describe('updateOrganisationPaymentStatus', () => {
  it('should not update the organisation if payment is in progress', () => {
    const payment = createPayment('payment_in_progress')
    const initialOrganisation = createOrganisation()
    const updatedOrganisation = updateOrganisationPaymentStatus(initialOrganisation, payment)
    expect(updatedOrganisation).toEqual(initialOrganisation)
    expect(isEnabled(updatedOrganisation)).toBe(false)
  })

  it('should enable organisation if payment successfull', () => {
    const payment = createPayment('payment_succeeded')
    const initialOrganisation = createOrganisation()
    const updatedOrganisation = updateOrganisationPaymentStatus(initialOrganisation, payment)
    expect(updatedOrganisation).toEqual({
      ...initialOrganisation,
      apiCodes: [expect.anything()],
      disabledReason: null,
      isDisabled: false,
      disableAfter: payment.servicePeriodEnd
    })
    expect(isEnabled(updatedOrganisation)).toBe(true)
  })

  it('should disable organisation if payment failed', () => {
    const payment = createPayment('payment_failed')
    const initialOrganisation = createOrganisation()
    const updatedOrganisation = updateOrganisationPaymentStatus(initialOrganisation, payment)
    expect(updatedOrganisation).toEqual({ ...initialOrganisation, disabledReason: 'Payment failed' })
    expect(isEnabled(updatedOrganisation)).toBe(false)
  })

  it('should not move disableAfter backwards for refunded payment when disableAfter is null', () => {
    const payment = createPayment('refund_succeeded')
    const initialOrganisation = { organisationId: ORANISATION_ID, name: ORANISATION_NAME, disableAfter: null, isDisabled: false }
    const updatedOrganisation = updateOrganisationPaymentStatus(initialOrganisation, payment)
    expect(updatedOrganisation).toEqual(initialOrganisation)
  })

  it('should set disabledAfter to last successfull payment', () => {
    const initialOrganisation = createOrganisation()
    const date = new Date()
    const payments = [
      createPayment('payment_succeeded', addYears(date, 1)),
      createPayment('payment_succeeded', addYears(date, 1)),
      createPayment('payment_succeeded', addYears(date, 1))
    ]
    const updatedOrganisation = createPaymentEvents(initialOrganisation, payments)
    expect(updatedOrganisation.disableAfter).toEqual(payments[2].servicePeriodEnd)
    expect(isEnabled(updatedOrganisation)).toBe(true)
  })

  it('should set disabledAfter to last successfull payment when last payments failed', () => {
    const initialOrganisation = createOrganisation()
    const date = new Date()
    const payments = [
      createPayment('payment_succeeded', addYears(date, 1)),
      createPayment('payment_succeeded', addYears(date, 1)),
      createPayment('payment_failed', addYears(date, 1))
    ]
    const updatedOrganisation = createPaymentEvents(initialOrganisation, payments)
    expect(updatedOrganisation.disableAfter).toEqual(payments[1].servicePeriodEnd)
    expect(isEnabled(updatedOrganisation)).toBe(true)
  })

  it('should set disabledAfter to last successfull payment when last payments pending', () => {
    const initialOrganisation = createOrganisation()
    const date = new Date()
    const payments = [
      createPayment('payment_succeeded', addYears(date, 1)),
      createPayment('payment_succeeded', addYears(date, 2)),
      createPayment('payment_in_progress', addYears(date, 3))
    ]
    const updatedOrganisation = createPaymentEvents(initialOrganisation, payments)
    expect(updatedOrganisation.disableAfter).toEqual(payments[1].servicePeriodEnd)
    expect(isEnabled(updatedOrganisation)).toBe(true)
  })

  it.each(['payment_in_progress', 'payment_succeeded', 'payment_failed'])(
    'should not update the disabled status of a disabled organisation',
    (paymentStatus) => {
      const payment = createPayment(paymentStatus)
      const org = createOrganisation(true)
      const organisation = updateOrganisationPaymentStatus(org, payment)
      expect(isEnabled(organisation)).toBe(false)
    }
  )
})

const createOrganisation = (isDisabled = false) => ({
  organisationId: ORANISATION_ID,
  name: ORANISATION_NAME,
  disableAfter: faker.date.past(),
  isDisabled
})

const createPayment = (status, servicePeriodEnd) => {
  console.log('servicePeriodEnd before if', servicePeriodEnd)
  if (!servicePeriodEnd) {
    servicePeriodEnd = addYears(new Date(), 1)
  }

  return {
    organisationId: 'ORGID',
    paymentId: 'qfs1896l6uo7i4p1rdm2cu5did',
    amount: 2600,
    servicePeriodEnd,
    servicePeriodStart: new Date(),
    status
  }
}

const addYears = (date, years = 1) => new Date(date.setFullYear(date.getFullYear() + years))

const createPaymentEvents = (initialOrganisation, events) => {
  return events.reduce((event, currentOrganisation) => updateOrganisationPaymentStatus(event, currentOrganisation), initialOrganisation)
}

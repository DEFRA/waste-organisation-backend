import { describe, expect } from 'vitest'
import { updateFromGovPayEvent, isPending, isPaid, isRefunded, initiatePayment } from './payment.js'
import { faker } from '@faker-js/faker'

describe('payment domain', () => {
  test.each([
    ['payment_succeeded', { payment: 'capturable' }, isPaid],
    ['payment_in_progress', { payment: 'capturable' }, isPending],
    ['payment_in_progress', { payment: 'success' }, isPaid],
    ['payment_succeeded', { refund: 'success' }, isRefunded],
    ['refund_succeeded', { refund: 'submitted' }, isRefunded]
  ])('transition restriction', (status, { payment, refund }, predicate) => {
    const organisationId = faker.string.uuid()
    const o = initiatePayment({
      organisationId,
      amount: faker.number.int(),
      description: faker.commerce.productDescription(),
      returnUrl: faker.internet.url(),
      metadata: { servicePeriodStart: faker.date.anytime().toISOString(), servicePeriodEnd: faker.date.anytime().toISOString() },
      reference: faker.string.uuid(),
      idempotencyKey: faker.string.uuid()
    })
    const org = updateFromGovPayEvent({ ...o, status }, { state: { status: payment }, refund_summary: { status: refund } }, console)
    expect(predicate(org), `Transition from ${status} should match ${predicate} but is ${org.status} when payment ${payment} and refund ${refund}`).toEqual(
      true
    )
  })
})

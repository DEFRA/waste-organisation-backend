import { paymentSchema } from '../domain/payment.js'
import * as domain from '../domain/index.js'
import { idempontentlyInitiatePayment } from './payments.js'

const deferred = () => {
  let res, rej
  const promise = new Promise((resolve, reject) => {
    res = resolve
    rej = reject
  })
  return { promise, resolve: res, reject: rej }
}

describe('idempotency behaviour', () => {
  const organisationId = 'org123'
  const createdAt = new Date('2026-06-26T14:00:00.000Z')

  it('should validate minimalist payment', () => {
    expect(domain.validate({ organisationId: 'abc123', idempotencyKey: 'qqq', period: '1981/1982' }, paymentSchema)).toEqual({
      organisationId: 'abc123',
      idempotencyKey: 'qqq',
      period: '1981/1982'
    })
  })

  test.each([
    [
      (findPayments, findPayments2) => {
        findPayments.resolve([{ organisationId }])
        findPayments2.resolve([{ organisationId }, { organisationId }])
      },
      (result, result2, deletePayment, deletePayment2) => {
        expect(result.message).toEqual('success')
        expect(result2.message).toEqual('duplicate payment')
        expect(deletePayment).not.toHaveBeenCalled()
        expect(deletePayment2).toHaveBeenCalled()
      }
    ],
    [
      (findPayments, findPayments2) => {
        findPayments.resolve([{ organisationId }, { organisationId }])
        findPayments2.resolve([{ organisationId }])
      },
      (result, result2, deletePayment, deletePayment2) => {
        expect(result.message).toEqual('duplicate payment')
        expect(result2.message).toEqual('success')
        expect(deletePayment).toHaveBeenCalled()
        expect(deletePayment2).not.toHaveBeenCalled()
      }
    ],
    [
      (findPayments, findPayments2) => {
        findPayments.resolve([{ organisationId }, { organisationId }])
        findPayments2.resolve([{ organisationId }, { organisationId }])
      },
      (result, result2, deletePayment, deletePayment2) => {
        expect(result.message).toEqual('duplicate payment')
        expect(result2.message).toEqual('duplicate payment')
        expect(deletePayment).toHaveBeenCalled()
        expect(deletePayment2).toHaveBeenCalled()
      }
    ],
    [
      (findPayments, findPayments2) => {
        findPayments.resolve([{ organisationId, status: 'refund_succeeded' }, { organisationId }, { organisationId }])
        findPayments2.resolve([{ organisationId, status: 'refund_succeeded' }, { organisationId }])
      },
      (result, result2, deletePayment, deletePayment2) => {
        expect(result.message).toEqual('duplicate payment')
        expect(result2.message).toEqual('success')
        expect(deletePayment).toHaveBeenCalled()
        expect(deletePayment2).not.toHaveBeenCalled()
      }
    ],
    [
      (findPayments, findPayments2) => {
        findPayments.resolve([{ organisationId, status: 'payment_failed' }, { organisationId }, { organisationId }])
        findPayments2.resolve([{ organisationId, status: 'payment_failed' }, { organisationId }])
      },
      (result, result2, deletePayment, deletePayment2) => {
        expect(result.message).toEqual('duplicate payment')
        expect(result2.message).toEqual('success')
        expect(deletePayment).toHaveBeenCalled()
        expect(deletePayment2).not.toHaveBeenCalled()
      }
    ],
    [
      (findPayments, findPayments2) => {
        findPayments.resolve([{ organisationId, status: 'payment_succeeded' }, { organisationId }, { organisationId }])
        findPayments2.resolve([{ organisationId, status: 'payment_succeeded' }, { organisationId }])
      },
      (result, result2, deletePayment, deletePayment2) => {
        expect(result.message).toEqual('duplicate payment')
        expect(result2.message).toEqual('duplicate payment')
        expect(deletePayment).toHaveBeenCalled()
        expect(deletePayment2).toHaveBeenCalled()
      }
    ],
    [
      (findPayments, findPayments2) => {
        findPayments.resolve([{ organisationId, status: 'payment_in_progress' }, { organisationId }, { organisationId }])
        findPayments2.resolve([{ organisationId, status: 'payment_in_progress' }, { organisationId }])
      },
      (result, result2, deletePayment, deletePayment2) => {
        expect(result.message).toEqual('duplicate payment')
        expect(result2.message).toEqual('duplicate payment')
        expect(deletePayment).toHaveBeenCalled()
        expect(deletePayment2).toHaveBeenCalled()
      }
    ],
    [
      (findPayments, findPayments2) => {
        findPayments.resolve([{ organisationId, status: 'payment_in_progress', createdAt }, { organisationId }])
        findPayments2.resolve([{ organisationId, status: 'payment_in_progress', createdAt }, { organisationId }, { organisationId }])
      },
      (result, result2, deletePayment, deletePayment2) => {
        expect(result.message).toEqual('success')
        expect(result2.message).toEqual('duplicate payment')
        expect(deletePayment).not.toHaveBeenCalled()
        expect(deletePayment2).toHaveBeenCalled()
      }
    ]
  ])('should create at most on payment per period', async (deliverPromises, assertResults) => {
    const findPayments = deferred()
    const findPayments2 = deferred()
    const deletePayment = vi.fn()
    const deletePayment2 = vi.fn()

    const resultPromise = idempontentlyInitiatePayment(
      async () => ({}),
      () => findPayments.promise,
      deletePayment,
      async () => ({ payload: { payment_id: 'payid', _links: ['link1'] }, statusCode: 200, status: 'success' }),
      async (idempotencyKey, paymentId, links) => ({ idempotencyKey, paymentId, links, organisationId }),
      new Date('2026-06-26T13:00:01.001Z')
    )
    const resultPromise2 = idempontentlyInitiatePayment(
      async () => ({}),
      () => findPayments2.promise,
      deletePayment2,
      async () => ({ payload: { payment_id: 'payid', _links: ['link1'] }, statusCode: 200, status: 'success' }),
      async (idempotencyKey, paymentId, links) => ({ idempotencyKey, paymentId, links, organisationId }),
      new Date('2026-06-26T13:00:01.000Z')
    )

    deliverPromises(findPayments, findPayments2)
    const result = await resultPromise
    const result2 = await resultPromise2
    assertResults(result, result2, deletePayment, deletePayment2)
  })
})

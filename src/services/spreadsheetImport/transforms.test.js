import { compose } from './transforms.js'

describe('compose', () => {
  test('should compose functions', () => {
    const f = compose(
      (x) => {
        console.log(`x>> ${x} * 2`)
        return x * 2
      },
      (x) => {
        console.log(`x>> ${x} + 9`)
        return x + 9
      }
    )
    expect(f(12)).toBe(42)
  })
  test('should collect exceptions', () => {
    const e1 = new Error('1')
    const e2 = new Error('2')
    const f = compose(
      (x) => {
        console.log(`after - ${x}`)
        return x
      },
      () => {
        throw e1
      },
      () => {
        throw e2
      },
      () => {
        console.log(`before`)
        return 'before'
      }
    )
    expect(f).toThrowError(expect.objectContaining({ collectedErrors: [e2, e1] }))
  })

  test('should nest collected exceptions', () => {
    const e1 = new Error('1')
    const e2 = new Error('2')
    const e3 = new Error('3')
    const f = compose(
      (x) => {
        console.log(`after - ${x}`)
        return x
      },
      compose(
        () => {
          throw e1
        },
        () => {
          throw e3
        }
      ),
      () => {
        throw e2
      },
      () => {
        console.log(`before`)
        return 'before'
      }
    )
    expect(f).toThrowError(expect.objectContaining({ collectedErrors: [e2, e3, e1] }))
  })
})

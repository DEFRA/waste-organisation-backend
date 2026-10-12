import { updateIn } from './utils.js'
import { parseToString } from './parsers.js'

describe('updateIn', () => {
  test('does not create empty nested objects when the cell is blank', () => {
    const row = {}
    updateIn(row, ['carrier', 'address', 'postcode'], '', parseToString)
    expect(row).toEqual({})
  })

  test('sets nested values when present', () => {
    const row = {}
    updateIn(row, ['carrier', 'address', 'postcode'], 'TR16 5TD', parseToString)
    expect(row).toEqual({ carrier: { address: { postcode: 'TR16 5TD' } } })
  })

  test('leaves data unchanged when the path is empty', () => {
    const row = { keep: true }
    expect(updateIn(row, [], 'x', parseToString)).toEqual({ keep: true })
    expect(updateIn(row, null, 'x', parseToString)).toEqual({ keep: true })
  })

  test('leaves data unchanged when the transform returns undefined', () => {
    const row = {}
    updateIn(row, ['carrier', 'address', 'postcode'], 'TR16 5TD', () => undefined)
    expect(row).toEqual({})
  })

  test('sets a value without a transform function', () => {
    const row = {}
    updateIn(row, ['siteName'], 'Depot')
    expect(row).toEqual({ siteName: 'Depot' })
  })
})

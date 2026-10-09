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
})

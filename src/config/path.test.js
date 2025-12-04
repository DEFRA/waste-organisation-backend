import { paths, pathTo } from './paths.js'

describe('pathTo', () => {
  test('should expand url with route params', () => {
    const p = paths.putOrganisation
    const o = { userId: 123, organisationId: 456 }
    expect(pathTo(p, o)).toBe('/user/123/organisation/456')
  })

  test('should error when key missing', () => {
    const p = paths.putOrganisation
    const o = { userId: 123 }
    expect(() => pathTo(p, o)).toThrow(/Missing key/)
  })
})

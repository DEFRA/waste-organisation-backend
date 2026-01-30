// prettier-ignore
export const paths = {
  getOrganisations:     '/user/{userId}/organisations',
  putOrganisation:      '/user/{userId}/organisation/{organisationId}',
  getSpreadsheets:      '/spreadsheet/{organisationId}',
  getOneSpreadsheet:    '/spreadsheet/{organisationId}/{uploadId}',
  putSpreadsheet:       '/spreadsheet/{organisationId}/{uploadId}',
  saveApiCode:          '/organisation/{organisationId}/apiCodes/{apiCode}',
  createApiCode:        '/organisation/{organisationId}/apiCodes',
  listApiCodes:         '/organisation/{organisationId}/apiCodes',
  lookupOrgFromApiCode: '/organisation/{apiCode}'
}

export const pathTo = (route, params) => {
  const routeParams = route.match(/\{\w+\*?\}/g)

  for (const r of routeParams) {
    const parts = r.match(/\{(\w+)\*?\}/)
    const src = params[parts[1]]
    const dst = parts[0]
    const key = parts[1]

    if (src) {
      route = route.replace(dst, src)
    } else {
      throw new Error(`Missing key ${key} in route ${route}`)
    }
  }
  return route
}

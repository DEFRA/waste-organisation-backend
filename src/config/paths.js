export const paths = {
  getOrganisations: '/user/{userId}/organisations',
  putOrganisation: '/user/{userId}/organisation/{organisationId}'
}

export const pathTo = (route, params, options) => {
  const routeParams = route.match(/\{\w+\*?\}/g)

  for (let i = 0; i < routeParams.length; i++) {
    const parts = routeParams[i].match(/\{(\w+)\*?\}/)
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

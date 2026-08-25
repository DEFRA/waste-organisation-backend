export const updateIn = (data, path, v, func) => {
  if (path) {
    path.reduce((acc, x, i) => {
      // prettier-ignore
      if (i === path.length - 1) {
          const value = func ? func(acc[x], v) : v
          acc[x] = value
        } else if (acc[x] == null) { // nosonar
          acc[x] = {}
        }
      return acc[x]
    }, data)
  }
  return data
}

export const getIn = (obj, path) => path?.reduce((x, k) => x && x[k], obj)

export const deleteLeaf = (data, path) => {
  if (path) {
    path.reduce((acc, x, i) => {
      // prettier-ignore
      if (i === path.length - 1) {
        delete acc[x]
      } else if (acc == null || acc[x] == null) { // nosonar
        return null
      }
      return acc[x]
    }, data)
  }
  return data
}

export const distinct = (xs) => {
  const seen = new Set()
  return xs.filter((x) => {
    const key = JSON.stringify(x)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

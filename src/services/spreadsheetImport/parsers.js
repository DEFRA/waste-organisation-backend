export const parseComponentCodes = (existing, data) => {
  const result = existing ?? []
  try {
    result.concat(
      data.split(/;/).map((y) => {
        const [_, code, c] = y
          .match(/([^=]*)=(.*)/) // nosonar
          .map((x) => x.trim())
        return { code, concentration: c.match(/^([0-9.]+)$/) ? Number(c) : c }
      })
    )
    return result
  } catch {
    throw new Error('Cannot parse component codes')
  }
}

export const parseComponentNames = (existing, data) => {
  const result = existing ?? []
  try {
    const parsed = data.split(/;/).flatMap((y) => {
      const [_, name, c] = y
        .match(/([^=]*)=(.*)/) // nosonar
        .map((x) => x.trim())
      return { name, concentration: c.match(/^([0-9.]+)$/) ? Number(c) : c }
    })
    return result.concat(parsed)
  } catch {
    throw new Error('Cannot parse component names')
  }
}

export const mergeDate = (existing, data) => {
  if (!(data instanceof Date)) {
    throw new Error('Cannot parse date')
  }
  if (existing == null) {
    return data
  } else {
    const date = new Date(existing.getTime())
    date.setFullYear(data.getFullYear())
    date.setMonth(data.getMonth())
    date.setDate(data.getDate())
    return date
  }
}

export const mergeTime = (existing, data) => {
  if (!(data instanceof Date)) {
    throw new Error('Cannot parse time')
  }
  if (existing == null) {
    return data
  } else {
    const date = new Date(existing.getTime())
    date.setHours(data.getHours())
    date.setMinutes(data.getMinutes())
    date.setSeconds(data.getSeconds())
    return date
  }
}

export const parseEstimate = (() => {
  const estVals = ['estimate', 'est', 'y', 'yes', 'true', true, 'TRUE()']
  const actVals = ['actual', 'act', 'n', 'no', 'false', false, 'FALSE()']
  return (existing, est) => {
    if (est) {
      const e = typeof est === 'string' || est instanceof String ? est.toLowerCase() : (est.formula ?? est)
      if (estVals.includes(e)) {
        return true
      }
      if (actVals.includes(e)) {
        return false
      }
      return existing
    } else {
      throw new Error('Cannot parse estimate.')
    }
  }
})()

export const parseBoolean = (() => {
  const trueVals = ['y', 'yes', 'true', true, 'TRUE()']
  const falseVals = ['n', 'no', 'false', false, 'FALSE()']
  return (existing, data) => {
    const e = typeof data === 'string' || data instanceof String ? data.toLowerCase() : (data.formula ?? data)
    if (trueVals.includes(e)) {
      return true
    }
    if (falseVals.includes(e)) {
      return false
    }
    return existing
  }
})()

export const parseDisposalCodes = (() => {
  const metricConversions = { grams: 'Grams', kilograms: 'Kilograms', tonnes: 'Tonnes', g: 'Grams', kg: 'Kilograms', T: 'Tonnes' }
  const parseDC = (el) => {
    const [codeStr, amountStr, metricStr, est] = el.split(/=/).map((x) => x.trim())
    if (est) {
      const isEstimate = parseEstimate(null, est)
      const amount = amountStr?.match(/^[0-9,]+$/) ? Number(amountStr.replace(/,/g, '')) : amountStr
      const code = codeStr.replace(/^([A-Z])([0_ ]*)([1-9][0-9]*)$/, '$1$3')
      const metric = metricConversions[metricStr?.toLowerCase()] ?? metricStr
      return { code, weight: { metric, amount, isEstimate } }
    } else {
      throw new Error(`Cannot parse disposal / recovery codes (${el})`)
    }
  }
  return (existing, data) => {
    const result = existing ?? []
    return result.concat(data.split(/;/).map(parseDC))
  }
})()

export const parseEWCCodes = (existing, data) => {
  const result = existing ?? []
  try {
    return result.concat(`${data}`.split(/[,;]/).map((y) => y.replace(/[^0-9]/g, '')))
  } catch {
    throw new Error(`Cannot parse EWC codes`)
  }
}

export const parseHazCodes = (existing, data) => {
  const result = existing ?? []
  try {
    return result.concat(data.split(/[,;]/).map((y) => y.trim().replace(/^HP([0_ ]*)([1-9][0-9]*)$/, 'HP_$2')))
  } catch {
    throw new Error('Cannot parse Haz codes')
  }
}

export const parseContainerType = (existing, data) => {
  const c = typeof data === 'string' || data instanceof String ? data.toUpperCase() : null
  if (c) {
    return c.replace(/^\[([A-Z]+)\].*$/, '$1')
  }
  return existing
}

export const parseToString = (existing, data) => {
  return data ? data.toString() : existing
}

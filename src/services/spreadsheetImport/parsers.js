const parseConcentration = (value) => {
  const [, operator, amount] = value.match(/^([<>])?\s*([0-9.]+)$/) ?? []

  if (!amount) {
    return { concentration: value }
  }

  return {
    concentration: Number(amount),
    ...(operator && { concentrationOperator: operator })
  }
}

export const parseComponentCodes = (existing, data) => {
  const result = existing ?? []
  try {
    return result.concat(
      data.split(/;/).flatMap((y) => {
        if (y.trim() === '') {
          return []
        }
        const [_, code, c] = y
          .match(/([^=]*)=(.*)/) // nosonar
          .map((x) => x.trim())
        return [{ code, ...parseConcentration(c) }]
      })
    )
  } catch {
    throw new Error(`Cannot parse component codes`)
  }
}

export const parseComponentNames = (existing, data) => {
  const result = existing ?? []
  try {
    const parsed = data.split(/;/).flatMap((y) => {
      if (y.trim() === '') {
        return []
      }
      const [_, name, c] = y
        .match(/([^=]*)=(.*)/) // nosonar
        .map((x) => x.trim())
      return [{ name, ...parseConcentration(c) }]
    })
    return result.concat(parsed)
  } catch {
    throw new Error(`Cannot parse component names`)
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
  const isCodeRegex = /^([A-Z])([0_ ]*)([1-9][0-9]*)$/
  const cleanCode = (codeStr) => codeStr.replace(isCodeRegex, '$1$3')
  const parseDC = (el) => {
    const [codeStr, amountStr, metricStr, est] = el.split(/=/).map((x) => x.trim())
    if (est) {
      const isEstimate = parseEstimate(null, est)
      const amount = amountStr?.match(/^[0-9,.]+$/) ? Number(amountStr.replaceAll(/,/g, '')) : amountStr
      const code = cleanCode(codeStr)
      const metric = metricConversions[metricStr?.toLowerCase()] ?? metricStr
      return { code, weight: { metric, amount, isEstimate } }
    } else {
      throw new Error(`Cannot parse disposal / recovery codes (${el})`)
    }
  }
  return (existing, data) => {
    const result = existing ?? []
    const entries = data.split(/;/)
    const e = entries[0]?.trim()
    if (result.length === 0 && entries.length === 1 && e.match(isCodeRegex)) {
      return [{ code: cleanCode(e), weight: 'whole item' }]
    } else {
      return result.concat(entries.map(parseDC))
    }
  }
})()

export const parseEWCCodes = (existing, data) => {
  const result = existing ?? []
  try {
    const codes = `${data}`
      .split(/[,;]/)
      .map((y) => y.replaceAll(/[^0-9]/g, ''))
      .filter((x) => x)
    return result.concat(codes)
  } catch {
    throw new Error(`Cannot parse EWC codes`)
  }
}

const isMissing = (data) => data == null || (typeof data === 'string' && data.trim() === '')

export const parseHazCodes = (existing, data) => {
  const result = existing ?? []
  try {
    if (typeof data === 'string' && data.trim() === '') {
      return result
    }
    return result.concat(
      data
        .split(/[,;]/)
        .map((y) => y.trim().replace(/^HP([0_ ]*)([1-9][0-9]*)$/, 'HP_$2'))
        .filter((y) => y)
    )
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

export const parseTitleCase = (existing, data) => {
  if (!data) {
    return existing
  }
  const trimmed = data.toString().trim()
  if (!trimmed) {
    return existing
  }
  return trimmed.toLowerCase().replaceAll(/\b\w/g, (c) => c.toUpperCase())
}

export const parseToString = (existing, data) => {
  if (isMissing(data)) {
    return existing
  }
  const trimmed = data.toString().trim()
  return trimmed || existing
}

export const requiredString = (existing, data) => {
  const d = data ? data.toString().trim() : existing
  if (d) {
    return d
  } else {
    throw new Error('Please provide a value')
  }
}

export const parseToNumber = (existing, data) => {
  if (isMissing(data)) {
    return existing
  }
  return Number(data)
}

export const parseRegStatements = (existing, data) => {
  const result = existing ?? []
  try {
    const codes = `${data}`
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter((x) => x)
      .map((x) => Number(x))
    return result.concat(codes)
  } catch {
    throw new Error('Cannot parse regulatory position statements')
  }
}

const parseWholeNumber = (part) => {
  if (part == null || part === '') {
    return null
  }
  const n = Number(part)
  return Number.isInteger(n) ? n : null
}

const parseUkDateTime = (text) => {
  const [datePart, timePart, extra] = text.trim().split(/\s+/)
  if (!datePart || extra) {
    return null
  }
  const [day, month, year] = datePart.split('/').map(parseWholeNumber)
  if (day == null || month == null || year == null || year < 1000) {
    return null
  }

  let hours = 0
  let minutes = 0
  let seconds = 0
  if (timePart) {
    const timeBits = timePart.split(':').map(parseWholeNumber)
    if (timeBits.length < 2 || timeBits.length > 3 || timeBits.some((part) => part == null)) {
      return null
    }
    hours = timeBits[0]
    minutes = timeBits[1]
    seconds = timeBits[2] ?? 0
  }

  const parsed = new Date(year, month - 1, day, hours, minutes, seconds)
  const matchesParts = parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day && parsed.getHours() === hours && parsed.getMinutes() === minutes && parsed.getSeconds() === seconds
  return matchesParts ? parsed : null
}

export const correctDateTimezone = (existing, data) => {
  if (data instanceof Date) {
    // Warning: assumes Europe/London timezone
    if (data.getTimezoneOffset() < 0) {
      return new Date(data.getTime() - 60 * 60 * 1000) // subtract 1 hour
    } else {
      return data
    }
  }
  if (typeof data === 'string') {
    const parsed = parseUkDateTime(data)
    if (parsed) {
      return parsed
    }
  }
  return data || existing
}

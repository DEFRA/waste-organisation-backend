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

const parseUkTime = (timePart) => {
  if (!timePart) {
    return { hours: 0, minutes: 0, seconds: 0 }
  }
  const bits = timePart.split(':').map(parseWholeNumber)
  const [hours, minutes, seconds, extraTime] = bits
  if (minutes == null || extraTime !== undefined || bits.some((part) => part == null)) {
    return null
  }
  return { hours, minutes, seconds: seconds ?? 0 }
}

const parseUkDate = (datePart) => {
  const [day, month, year] = datePart.split('/').map(parseWholeNumber)
  if (day == null || month == null || year == null || year < 1000) {
    return null
  }
  return { day, month, year }
}

const dateTimeMatchesParts = (parsed, { day, month, year, hours, minutes, seconds }) =>
  parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day && parsed.getHours() === hours && parsed.getMinutes() === minutes && parsed.getSeconds() === seconds

const parseUkDateTime = (text) => {
  const [datePart, timePart, extra] = text.trim().split(/\s+/)
  if (!datePart || extra) {
    return null
  }
  const date = parseUkDate(datePart)
  const time = parseUkTime(timePart)
  if (!date || !time) {
    return null
  }
  const parts = { ...date, ...time }
  const parsed = new Date(parts.year, parts.month - 1, parts.day, parts.hours, parts.minutes, parts.seconds)
  return dateTimeMatchesParts(parsed, parts) ? parsed : null
}

// Rewrites zoneless ISO-like text (2026-10-16T16:39:53 or 2026-10-16 16:39) as dd/mm/yyyy hh:mm:ss so it is parsed as UK local time
const isoToUkDateTime = (text) => text.trim().replace(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](.*))?$/, '$3/$2/$1 $4')

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
    const parsed = parseUkDateTime(isoToUkDateTime(data))
    if (parsed) {
      return parsed
    }
  }
  return data || existing
}

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

const ukOffsetFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })

// Offset (ms) of Europe/London from UTC at the given instant: 0 in GMT, 3600000 in BST
const ukOffsetAt = (instant) => {
  const p = Object.fromEntries(ukOffsetFormatter.formatToParts(instant).map(({ type, value }) => [type, Number(value)]))
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant.getTime() / 1000) * 1000
}

const dateTimeMatchesParts = (utcWallClock, { day, month, year, hours, minutes, seconds }) =>
  utcWallClock.getUTCFullYear() === year && utcWallClock.getUTCMonth() === month - 1 && utcWallClock.getUTCDate() === day && utcWallClock.getUTCHours() === hours && utcWallClock.getUTCMinutes() === minutes && utcWallClock.getUTCSeconds() === seconds

// Interprets the parts as Europe/London wall-clock time (independent of the server timezone).
// Returns the matching instant, or null if the parts are not a valid date/time.
const ukWallClockToDate = (parts, milliseconds = 0) => {
  const { year, month, day, hours, minutes, seconds } = parts
  const wallClock = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds, milliseconds))
  if (!dateTimeMatchesParts(wallClock, parts)) {
    return null
  }
  return new Date(wallClock.getTime() - ukOffsetAt(wallClock))
}

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
  return ukWallClockToDate(parts)
}

// e.g. 2026-10-16T16:39:53 or 2026-10-16 16:39 (no zone suffix => assumed UK local time)
const isoLikeDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/

const parseIsoLikeDateTime = (text) => {
  const match = isoLikeDateTimePattern.exec(text.trim())
  if (!match) {
    return null
  }
  const [year, month, day, hours = 0, minutes = 0, seconds = 0] = match.slice(1, 7).map((part) => (part === undefined ? undefined : Number(part)))
  const milliseconds = match[7] ? Number(match[7].padEnd(3, '0')) : 0
  return ukWallClockToDate({ year, month, day, hours, minutes, seconds }, milliseconds)
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
    const parsed = parseUkDateTime(data) ?? parseIsoLikeDateTime(data)
    if (parsed) {
      return parsed
    }
  }
  return data || existing
}

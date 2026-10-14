import JSZip from 'jszip'

// One cell, the whole token: optional $, column letters, optional $, row digits. $AC$6 or W9.
const RANGE_TOKEN = /^\$?([A-Z]+)\$?(\d+)$/
// Optional quotes around the sheet name, then !, then one cell or a pair. '7. Waste movement level'!$A$6 or Sheet1!$A$6.
const DEFINED_NAME = /^'?(.+?)'?!(\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?)$/

// Excel columns are base 26, but A is 1 rather than 0. 'A' is char code 65, so minus 64 makes A=1, Z=26, and AA=27. AC is 1*26+3 = 29.
const columnNumber = (letters) => {
  let number = 0
  for (const letter of letters) {
    number = number * 26 + letter.charCodeAt(0) - 64
  }
  return number
}

const columnLetters = (number) => {
  let letters = ''
  let remaining = number
  while (remaining > 0) {
    const index = (remaining - 1) % 26
    letters = String.fromCharCode(65 + index) + letters
    remaining = Math.floor((remaining - 1) / 26)
  }
  return letters
}

const decodeXml = (value) => value.replaceAll('&apos;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')

// One name="value" from a tag. \b keeps name from matching inside another attribute.
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]

const parseRange = (token) => {
  const [start, end] = token.split(':')
  const first = start.match(RANGE_TOKEN)
  const second = (end ?? start).match(RANGE_TOKEN)
  if (!first || !second) {
    return null
  }
  const startCol = columnNumber(first[1])
  const startRow = Number(first[2])
  const endCol = columnNumber(second[1])
  const endRow = Number(second[2])
  return {
    left: Math.min(startCol, endCol),
    right: Math.max(startCol, endCol),
    top: Math.min(startRow, endRow),
    bottom: Math.max(startRow, endRow)
  }
}

const sameRange = (range, other) => range.top === other.top && range.bottom === other.bottom && range.left === other.left && range.right === other.right

const intersect = (range, box) => {
  const top = Math.max(range.top, box.top)
  const bottom = Math.min(range.bottom, box.bottom)
  const left = Math.max(range.left, box.left)
  const right = Math.min(range.right, box.right)
  if (top > bottom || left > right) {
    return null
  }
  return { top, bottom, left, right }
}

const formatSqref = (range) => {
  const start = `${columnLetters(range.left)}${range.top}`
  if (range.left === range.right && range.top === range.bottom) {
    return start
  }
  return `${start}:${columnLetters(range.right)}${range.bottom}`
}

const formatDefinedName = (sheetName, range) => {
  const start = `$${columnLetters(range.left)}$${range.top}`
  const address = range.left === range.right && range.top === range.bottom ? start : `${start}:$${columnLetters(range.right)}$${range.bottom}`
  return `'${sheetName.replaceAll("'", "''")}'!${address}`
}

const usedBox = (xml) => {
  let maxRow = 0
  let maxCol = 0
  // A <row> start tag (not <rowBreaks>) and the row number in its r attribute. Stays inside that tag.
  for (const match of xml.matchAll(/<row\b[^>]*\br="(\d+)"/g)) {
    maxRow = Math.max(maxRow, Number(match[1]))
  }
  // A <c> cell start tag and its address, split into column letters and row digits, as in r="AC345".
  for (const match of xml.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"/g)) {
    maxCol = Math.max(maxCol, columnNumber(match[1]))
    maxRow = Math.max(maxRow, Number(match[2]))
  }
  if (!maxRow || !maxCol) {
    return null
  }
  return { top: 1, left: 1, bottom: maxRow, right: maxCol }
}

const clampSqrefValue = (value, box) => {
  const next = []
  // sqref lists several ranges separated by whitespace, e.g. "M9:M338 Q9:Q338".
  for (const piece of value.trim().split(/\s+/)) {
    const range = parseRange(piece)
    const clamped = range && intersect(range, box)
    next.push(clamped && !sameRange(range, clamped) ? formatSqref(clamped) : piece)
  }
  return next.join(' ')
}

const clampSqrefs = (xml, box) =>
  // Opening <dataValidation> tag, including a self-closing one. Only its sqref is rewritten.
  xml.replace(/<dataValidation\b([^>]*)>/g, (tag, attrs) => {
    // The sqref value is whatever sits between the double quotes.
    const nextAttrs = attrs.replace(/sqref="([^"]*)"/, (match, value) => {
      const next = clampSqrefValue(value, box)
      return next === value ? match : `sqref="${next}"`
    })
    return nextAttrs === attrs ? tag : `<dataValidation${nextAttrs}>`
  })

// workbook.xml names each sheet and points at it with r:id. The rels file maps that id to worksheets/sheetN.xml.
const sheetPaths = (workbookXml, relsXml) => {
  const targets = new Map()
  // A self-closing <Relationship .../>. Only worksheet targets are kept.
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const id = attribute(match[1], 'Id')
    const target = attribute(match[1], 'Target')
    if (id && target?.startsWith('worksheets/')) {
      targets.set(id, `xl/${target}`)
    }
  }

  const sheets = new Map()
  // A self-closing <sheet .../>.
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const name = decodeXml(attribute(match[1], 'name') ?? '')
    const path = targets.get(attribute(match[1], 'r:id'))
    if (name && path) {
      sheets.set(name, path)
    }
  }
  return sheets
}

const clampDefinedNames = (workbookXml, boxes) =>
  // <definedName ...>formula</definedName>. Attributes are the first group; the body is text with no nested tags.
  workbookXml.replace(/<definedName\b([^>]*)>([^<]*)<\/definedName>/g, (element, attrs, body) => {
    const parsed = decodeXml(body.trim()).match(DEFINED_NAME)
    if (!parsed) {
      return element
    }
    const sheetName = parsed[1].replaceAll("''", "'")
    const box = boxes.get(sheetName)
    const range = parseRange(parsed[2])
    if (!box || !range) {
      return element
    }
    const clamped = intersect(range, box)
    if (!clamped || sameRange(range, clamped)) {
      return element
    }
    return `<definedName${attrs}>${formatDefinedName(sheetName, clamped)}</definedName>`
  })

const readText = async (zip, path) => {
  const file = zip.file(path)
  return file ? file.async('string') : null
}

export const clampWildRanges = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer)
  const workbookXml = await readText(zip, 'xl/workbook.xml')
  const relsXml = await readText(zip, 'xl/_rels/workbook.xml.rels')
  if (!workbookXml || !relsXml) {
    return buffer
  }

  const boxes = new Map()
  let changed = false
  for (const [name, path] of sheetPaths(workbookXml, relsXml)) {
    const xml = await readText(zip, path)
    if (!xml) {
      continue
    }
    const box = usedBox(xml)
    if (!box) {
      continue
    }
    boxes.set(name, box)
    const clamped = clampSqrefs(xml, box)
    if (clamped !== xml) {
      zip.file(path, clamped)
      changed = true
    }
  }

  const clampedWorkbook = clampDefinedNames(workbookXml, boxes)
  if (clampedWorkbook !== workbookXml) {
    zip.file('xl/workbook.xml', clampedWorkbook)
    changed = true
  }
  if (!changed) {
    return buffer
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

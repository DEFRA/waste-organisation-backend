import { rawReadXlsx, decodeXml, readFileFromZip, sheetPaths, columnNumber, columnLetters } from './rawExcel.js'

// One cell, the whole token: optional $, column letters, optional $, row digits. $AC$6 or W9.
const RANGE_TOKEN = /^\$?([A-Z]+)\$?(\d+)$/
// Optional quotes around the sheet name, then !, then one cell or a pair. '7. Waste movement level'!$A$6 or Sheet1!$A$6.
const DEFINED_NAME = /^'?(.+?)'?!(\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?)$/

/* Unzip an XLSX buffer, validate the files, then re-zip the validated files so they can be parsed.

Validation is intended to be generous to the user rather than a gate. It must act tolerantly wrt user mistakes or unexpected behaviour and looks for things to fix that can be fixed. The sandbox itself takes care of heinous errors by containing a blow-up, and the parser and API decide if the data ends up valid enough.
 */
export const validate = async (buffer, logger) => {
  let zip, workbookXml, relsXml
  try {
    ;[zip, workbookXml, relsXml] = await rawReadXlsx(buffer)
  } catch (e) {
    logger.error('Could not unzip spreadsheet and main files for validation; using the original buffer')
    logger.error(e)
    return buffer
  }

  // fix unbounded named ranges
  const changed = await clampWildRanges(zip, workbookXml, relsXml)
  if (!changed) {
    // Nothing changed, return original buffer
    logger.debug('No change after validation')
    return buffer
  }
  logger.debug('Spreadsheet changed during validation')
  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/*
-----
Range-fixing functions
-----
*/

/* 
Prevent crazy-sized ranges that will cause exceljs to blow up the RAM, by limiting the range size to the actual number of cells used. 

Read each worksheet named in the workbook, derive a rectangle from the largest row/column addresses present in that sheet's XML, rewrite dataValidation sqref tokens and single-sheet definedName ranges to their intersection with that rectangle, write changed entries back into zip, and return whether any entry was rewritten. 

The clamping uses regexes rather than parsing the XML. It is the better option as of now, where it is the only validation performed. Parsing the XML would take much more RAM and likely introduce output serialisation errors, for no benefit since we only do surgical edits on 2 well-defined tags. If we get spreadsheets causing unforeseen problems with this we can always use a SAX parser to narrow the span and do the regex replace in it.
*/
export const clampWildRanges = async (zip, workbookXml, relsXml) => {
  const boxes = new Map()
  let changed = false
  for (const [name, path] of sheetPaths(workbookXml, relsXml)) {
    const xml = await readFileFromZip(zip, path)
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
  return changed
}

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

  /*
  Fallback for sheets whose <row>/<c> tags omit r="..." (cells written positionally):
  take the row count and, per row, the cell count (nth cell == column n when there are no gaps).
  */
  if (!maxRow || !maxCol) {
    let rowCount = 0
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      rowCount += 1
      maxCol = Math.max(maxCol, (rowMatch[1].match(/<c\b/g) ?? []).length)
    }
    maxRow = Math.max(maxRow, rowCount)
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

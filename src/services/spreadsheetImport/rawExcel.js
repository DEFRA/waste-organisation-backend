import JSZip from 'jszip'

export const decodeXml = (value) => value.replaceAll('&apos;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')

// One name="value" from a tag. \b keeps name from matching inside another attribute.
const attribute = (tag, name) => tag.match(new RegExp(String.raw`\b${name}="([^"]*)"`))?.[1]

/* Reads one of the files contained in the unzipped buffer, as text */
export const readFileFromZip = async (zip, path) => {
  const file = zip.file(path)
  return file ? file.async('string') : null
}

export const rawReadXlsx = async (buffer) => {
  // unzip xlsx
  const zip = await JSZip.loadAsync(buffer)

  // extract main files
  const workbookXml = await readFileFromZip(zip, 'xl/workbook.xml')
  const relsXml = await readFileFromZip(zip, 'xl/_rels/workbook.xml.rels')
  if (!workbookXml || !relsXml) {
    throw new Error('xlsx is missing xl/workbook.xml or xl/_rels/workbook.xml.rels')
  }
  return [zip, workbookXml, relsXml]
}

const excelColumnNamingBase = 26
const codePointOfA = 65
// Excel columns are base 26, but A is 1 rather than 0. 'A' is char code 65, so minus 64 makes A=1, Z=26, and AA=27. AC is 1*26+3 = 29.
export const columnNumber = (letters) => {
  let number = 0
  for (const letter of letters) {
    number = number * excelColumnNamingBase + letter.codePointAt(0) - codePointOfA + 1
  }
  return number
}

export const columnLetters = (number) => {
  let letters = ''
  let remaining = number
  while (remaining > 0) {
    const index = (remaining - 1) % excelColumnNamingBase
    letters = String.fromCodePoint(codePointOfA + index) + letters
    remaining = Math.floor((remaining - 1) / excelColumnNamingBase)
  }
  return letters
}

/* workbook.xml names each sheet and points at it with r:id. The rels file maps that id to worksheets/sheetN.xml */
export const sheetPaths = (workbookXml, relsXml) => {
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

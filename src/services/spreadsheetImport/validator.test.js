import JSZip from 'jszip'
import { validate, clampWildRanges } from './validator.js'

// Minimal xlsx parts. The sheet has cells up to C3, so every sheet's "used box"
// is columns A..C (1..3), rows 1..3 — ranges beyond that get clamped to it.
const workbookXml = (definedNames = '') => `<?xml version="1.0"?><workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>${definedNames}</workbook>`

const relsXml = '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="http://x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'

const sheetXml = (body = '') => `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c></row><row r="3"><c r="A3"><v>x</v></c></row></sheetData>${body}</worksheet>`

const buildXlsx = async ({ sheet = sheetXml(), definedNames = '' } = {}) => {
  const zip = new JSZip()
  zip.file('xl/workbook.xml', workbookXml(definedNames))
  zip.file('xl/_rels/workbook.xml.rels', relsXml)
  zip.file('xl/worksheets/sheet1.xml', sheet)
  return zip.generateAsync({ type: 'nodebuffer' })
}

const readEntry = async (buffer, path) => {
  const zip = await JSZip.loadAsync(buffer)
  return zip.file(path).async('string')
}

const dataValidation = (sqref) => `<dataValidation type="list" sqref="${sqref}"><formula1>"a,b"</formula1></dataValidation>`

describe('validate', () => {
  let logger
  beforeEach(() => {
    logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  })

  test('clamps a dataValidation sqref that runs past the used area', async () => {
    const buffer = await buildXlsx({ sheet: sheetXml(dataValidation('A1:A1000')) })

    const out = await validate(buffer, logger)

    expect(out).not.toBe(buffer) // re-zipped because something changed
    const xml = await readEntry(out, 'xl/worksheets/sheet1.xml')
    expect(xml).toContain('sqref="A1:A3"')
    expect(xml).not.toContain('A1:A1000')
  })

  test('clamps each range in a multi-range sqref independently', async () => {
    const buffer = await buildXlsx({ sheet: sheetXml(dataValidation('A1:A1000 B2:B2')) })

    const out = await validate(buffer, logger)

    const xml = await readEntry(out, 'xl/worksheets/sheet1.xml')
    expect(xml).toContain('sqref="A1:A3 B2:B2"') // first clamped, in-bounds one left alone
  })

  test('leaves an in-bounds sqref untouched and returns the original buffer (no re-zip)', async () => {
    const buffer = await buildXlsx({ sheet: sheetXml(dataValidation('A1:C3')) })

    const out = await validate(buffer, logger)

    expect(out).toBe(buffer) // nothing clamped -> same buffer reference, not regenerated
  })

  test('clamps an out-of-bounds defined name to the sheet used area', async () => {
    const definedNames = `<definedNames><definedName name="EVIL">'Sheet1'!$A$1:$P$1000</definedName></definedNames>`
    const buffer = await buildXlsx({ definedNames })

    const out = await validate(buffer, logger)

    expect(out).not.toBe(buffer)
    const wb = await readEntry(out, 'xl/workbook.xml')
    expect(wb).toContain("'Sheet1'!$A$1:$C$3")
    expect(wb).not.toContain('$P$1000')
  })

  test('leaves an in-bounds defined name untouched (no re-zip)', async () => {
    const definedNames = `<definedNames><definedName name="OK">'Sheet1'!$A$1:$C$3</definedName></definedNames>`
    const buffer = await buildXlsx({ definedNames })

    const out = await validate(buffer, logger)

    expect(out).toBe(buffer)
  })

  test('returns the original buffer and logs when the input is not a zip', async () => {
    const buffer = Buffer.from('this is definitely not a zip file')

    const out = await validate(buffer, logger)

    expect(out).toBe(buffer)
    expect(logger.error).toHaveBeenCalled()
  })

  test('returns the original buffer and logs when workbook.xml is missing', async () => {
    const zip = new JSZip()
    zip.file('xl/_rels/workbook.xml.rels', relsXml) // valid zip, but no xl/workbook.xml
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })

    const out = await validate(buffer, logger)

    expect(out).toBe(buffer)
    expect(logger.error).toHaveBeenCalled()
  })
})

describe('clampWildRanges', () => {
  // Build a loaded JSZip (clampWildRanges works on the zip object, not a buffer).
  const buildZip = ({ sheet = sheetXml(), definedNames = '' } = {}) => {
    const zip = new JSZip()
    zip.file('xl/workbook.xml', workbookXml(definedNames))
    zip.file('xl/_rels/workbook.xml.rels', relsXml)
    zip.file('xl/worksheets/sheet1.xml', sheet)
    return zip
  }

  test('returns true and rewrites the sheet when a sqref runs past the used area', async () => {
    const zip = buildZip({ sheet: sheetXml(dataValidation('A1:A1000')) })

    const changed = await clampWildRanges(zip, workbookXml(), relsXml)

    expect(changed).toBe(true)
    const xml = await zip.file('xl/worksheets/sheet1.xml').async('string')
    expect(xml).toContain('sqref="A1:A3"')
    expect(xml).not.toContain('A1:A1000')
  })

  test('returns false and leaves the sheet untouched when everything is in bounds', async () => {
    const sheet = sheetXml(dataValidation('A1:C3'))
    const zip = buildZip({ sheet })

    const changed = await clampWildRanges(zip, workbookXml(), relsXml)

    expect(changed).toBe(false)
    expect(await zip.file('xl/worksheets/sheet1.xml').async('string')).toBe(sheet) // byte-for-byte unchanged
  })

  test('clamps an out-of-bounds defined name and writes workbook.xml back into the zip', async () => {
    const definedNames = `<definedNames><definedName name="EVIL">'Sheet1'!$A$1:$P$1000</definedName></definedNames>`
    const zip = buildZip({ definedNames })

    const changed = await clampWildRanges(zip, workbookXml(definedNames), relsXml)

    expect(changed).toBe(true)
    const wb = await zip.file('xl/workbook.xml').async('string')
    expect(wb).toContain("'Sheet1'!$A$1:$C$3")
    expect(wb).not.toContain('$P$1000')
  })

  test('returns false when the sheet has no cells (no used box to clamp against)', async () => {
    const sheet = '<?xml version="1.0"?><worksheet><sheetData/>' + dataValidation('A1:A1000') + '</worksheet>'
    const zip = buildZip({ sheet })

    const changed = await clampWildRanges(zip, workbookXml(), relsXml)

    expect(changed).toBe(false)
    expect(await zip.file('xl/worksheets/sheet1.xml').async('string')).toBe(sheet)
  })

  test('derives the used box positionally when rows/cells omit r="..."', async () => {
    // No r attributes anywhere; three rows, the widest with three cells -> used box A1:C3.
    const body = '<row><c><v>1</v></c><c><v>2</v></c><c><v>3</v></c></row><row><c><v>a</v></c></row><row><c><v>b</v></c></row>'
    const sheet = `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData>${dataValidation('A1:A1000')}</worksheet>`
    const zip = buildZip({ sheet })

    const changed = await clampWildRanges(zip, workbookXml(), relsXml)

    expect(changed).toBe(true)
    const xml = await zip.file('xl/worksheets/sheet1.xml').async('string')
    expect(xml).toContain('sqref="A1:A3"')
    expect(xml).not.toContain('A1:A1000')
  })
})

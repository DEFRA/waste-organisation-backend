import JSZip from 'jszip'
import { decodeXml, readFileFromZip, rawReadXlsx, sheetPaths, columnNumber, columnLetters } from './rawExcel.js'

describe('columnNumber', () => {
  test.each([
    ['A', 1],
    ['Z', 26],
    ['AA', 27],
    ['AC', 29],
    ['XFD', 16384]
  ])('%s -> %i', (letters, n) => {
    expect(columnNumber(letters)).toBe(n)
  })
})

describe('columnLetters', () => {
  test.each([
    [1, 'A'],
    [26, 'Z'],
    [27, 'AA'],
    [29, 'AC'],
    [16384, 'XFD']
  ])('%i -> %s', (n, letters) => {
    expect(columnLetters(n)).toBe(letters)
  })

  test('is the inverse of columnNumber', () => {
    for (const n of [1, 26, 27, 52, 700, 16384]) {
      expect(columnNumber(columnLetters(n))).toBe(n)
    }
  })

  test('returns "" for 0 (no column)', () => {
    expect(columnLetters(0)).toBe('')
  })
})

describe('decodeXml', () => {
  test('decodes the five XML entities', () => {
    expect(decodeXml('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;')).toBe(`a & b <c> "d" 'e'`)
  })

  /* &amp; is resolved last, so a double-escaped entity decodes only one level */
  test('decodes only one level', () => {
    expect(decodeXml('&amp;lt;')).toBe('&lt;')
  })

  test('leaves plain text untouched', () => {
    expect(decodeXml('7. Waste movement level')).toBe('7. Waste movement level')
  })
})

describe('readFileFromZip', () => {
  test('returns the file contents as a string when present', async () => {
    const zip = new JSZip()
    zip.file('xl/workbook.xml', '<workbook/>')
    expect(await readFileFromZip(zip, 'xl/workbook.xml')).toBe('<workbook/>')
  })

  test('returns null when the file is absent', async () => {
    expect(await readFileFromZip(new JSZip(), 'xl/missing.xml')).toBeNull()
  })
})

describe('rawReadXlsx', () => {
  const buildXlsx = (files) => {
    const zip = new JSZip()
    for (const [path, content] of Object.entries(files)) {
      zip.file(path, content)
    }
    return zip.generateAsync({ type: 'nodebuffer' })
  }

  test('returns [zip, workbookXml, relsXml] when both main files are present', async () => {
    const buffer = await buildXlsx({ 'xl/workbook.xml': '<workbook/>', 'xl/_rels/workbook.xml.rels': '<Relationships/>' })

    const [zip, workbookXml, relsXml] = await rawReadXlsx(buffer)

    expect(zip).toBeInstanceOf(JSZip)
    expect(workbookXml).toBe('<workbook/>')
    expect(relsXml).toBe('<Relationships/>')
  })

  test('throws when xl/workbook.xml is missing', async () => {
    const buffer = await buildXlsx({ 'xl/_rels/workbook.xml.rels': '<Relationships/>' })
    await expect(rawReadXlsx(buffer)).rejects.toThrow(/missing/)
  })

  test('throws when the rels file is missing', async () => {
    const buffer = await buildXlsx({ 'xl/workbook.xml': '<workbook/>' })
    await expect(rawReadXlsx(buffer)).rejects.toThrow(/missing/)
  })

  test('throws when the buffer is not a zip', async () => {
    await expect(rawReadXlsx(Buffer.from('definitely not a zip'))).rejects.toThrow()
  })
})

describe('sheetPaths', () => {
  const workbookXml = (sheets) => `<workbook><sheets>${sheets}</sheets></workbook>`
  const relsXml = (rels) => `<Relationships>${rels}</Relationships>`

  test('maps each sheet name to its worksheet path via r:id', () => {
    const wb = workbookXml('<sheet name="Sheet1" sheetId="1" r:id="rId1"/><sheet name="Data" sheetId="2" r:id="rId2"/>')
    const rels = relsXml('<Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet5.xml"/>')

    const paths = sheetPaths(wb, rels)

    expect(paths.size).toBe(2)
    expect(paths.get('Sheet1')).toBe('xl/worksheets/sheet1.xml')
    expect(paths.get('Data')).toBe('xl/worksheets/sheet5.xml')
  })

  test('ignores relationships whose target is not a worksheet', () => {
    const wb = workbookXml('<sheet name="Sheet1" r:id="rId1"/>')
    const rels = relsXml('<Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId9" Target="styles.xml"/>')

    const paths = sheetPaths(wb, rels)

    expect(paths.size).toBe(1)
    expect(paths.get('Sheet1')).toBe('xl/worksheets/sheet1.xml')
  })

  test('decodes XML entities in sheet names', () => {
    const wb = workbookXml('<sheet name="A &amp; B" r:id="rId1"/>')
    const rels = relsXml('<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>')

    expect(sheetPaths(wb, rels).get('A & B')).toBe('xl/worksheets/sheet1.xml')
  })

  test('omits a sheet whose r:id has no matching worksheet relationship', () => {
    const wb = workbookXml('<sheet name="Orphan" r:id="rIdX"/>')
    const rels = relsXml('<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>')

    expect(sheetPaths(wb, rels).size).toBe(0)
  })
})

import fs from 'node:fs/promises'
import JSZip from 'jszip'
import { clampWildRanges } from './clampWildRanges.js'
import { parseExcelFile } from '../spreadsheetImport.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

const worksheetXml = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer)
  const files = zip.file(/xl\/worksheets\/sheet\d+\.xml/)
  return (await Promise.all(files.map((file) => file.async('string')))).join('\n')
}

const workbookXml = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer)
  return zip.file('xl/workbook.xml').async('string')
}

describe('clamp wild spreadsheet ranges', () => {
  test('production file sqrefs are cut back to the stored cells', async () => {
    const buffer = await fs.readFile('./test-resources/wild-validation-ranges.xlsx')
    const xml = await worksheetXml(await clampWildRanges(buffer))

    expect(xml).toContain('sqref="A1:AC345"')
    expect(xml).toContain('sqref="C1:C192"')
    expect(xml).toContain('sqref="R1:R192"')
    expect(xml).toContain('sqref="W9"')
    expect(xml).toContain('sqref="A9:B345"')
    expect(xml).toContain('sqref="M1:M338"')
    expect(xml).not.toContain('XFD1048576')
    expect(xml).not.toContain('C1048576')
    expect(xml).not.toContain('R1048576')
  })

  test('production file parses and keeps the clamped validations when written back', { timeout: 30000 }, async () => {
    const buffer = await fs.readFile('./test-resources/wild-validation-ranges.xlsx')
    const parsed = await parseExcelFile(buffer, 'org-id', logger)
    expect(parsed.workbook).toBeTruthy()

    const written = await worksheetXml(Buffer.from(await parsed.workbook.xlsx.writeBuffer()))
    expect(written).toContain('sqref="A1:AC345"')
    expect(written).toContain('sqref="C1:C192"')
    expect(written).toContain('sqref="R1:R192"')
    expect(written).not.toContain('1048576')
  })

  test('named-range template is cut back to the stored movement cells', { timeout: 30000 }, async () => {
    const buffer = await fs.readFile('./test-resources/wild-named-range.xlsx')
    const xml = await workbookXml(await clampWildRanges(buffer))

    expect(xml).toContain(`<definedName name="ColumnTitleRegion" localSheetId="7">'7. Waste movement level'!$A$6:$AC$347</definedName>`)
    expect(xml).toContain(`<definedName name="ColumnTitleRegion" localSheetId="8">'8. Waste item level'!$A$6:$R$6</definedName>`)

    const parsed = await parseExcelFile(buffer, 'org-id', logger)
    expect(parsed.workbook).toBeTruthy()
  })
})

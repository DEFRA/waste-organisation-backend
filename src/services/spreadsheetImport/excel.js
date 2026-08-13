import Excel from 'exceljs'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { config } from '../../config.js'
import crypto from 'node:crypto'

const logger = createLogger()

export const cellError = (colNumber, rowNumber, message, sheet, errorValue) => {
  const x = { coords: [colNumber, rowNumber], message }
  if (errorValue) {
    x.errorValue = errorValue
  }
  if (sheet) {
    x.sheet = sheet
  }
  return x
}

export const cellValueText = (() => {
  const plainText = (x) => x?.text ?? x
  return (val) => {
    const v = val?.richText ?? val
    if (Array.isArray(v)) {
      return v.reduce((acc, x) => acc + plainText(x.richText ?? x), '')
    } else {
      return plainText(v) ?? ''
    }
  }
})()

export const stripFormatting = (cell) => {
  cell.style = {
    border: {
      left: { style: 'thin' },
      right: { style: 'thin' },
      top: { style: 'thin' },
      bottom: { style: 'thin' }
    }
  }
  return cell
}

export const emptyCell = () => ({ richText: [] })

export const appendMessageToCell = (cell, message, font) => {
  const v = cell?.value?.richText ? cell?.value : emptyCell()
  const m = { text: (v.richText.length > 0 ? '\n' : '') + message }
  if (font) {
    m.font = font
  }
  v.richText.push(m)
  return v
}

export const collectCellErrors = (errors, updateFn, r, [colNumber, rowNumber], cell) => {
  try {
    updateFn(r, [colNumber, rowNumber], cellValueText(cell.value))
  } catch (ex) {
    const f = (e) => errors.push(cellError(e.colNumber ?? colNumber, rowNumber, e.message, null, cell.value))
    if (Array.isArray(ex.collectedErrors)) {
      ex.collectedErrors.map(f)
    } else {
      f(ex)
    }
  }
}

export const worksheetToArray = ({ worksheet, keyCols, updateFn, minRow, maxCol }) => {
  const elements = []
  const errors = []
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > minRow && keyCols.some((keyCol) => row.getCell(keyCol).value)) {
      row.getCell(1).value = emptyCell() // wipe error cells
      const r = {}
      // initialse missing keyCols with empty data
      keyCols.forEach((colNumber) => {
        if (row.getCell(colNumber)?.value == null) {
          collectCellErrors(errors, updateFn, r, [colNumber, rowNumber], { value: '' })
        }
      })
      // extract cell data
      row.eachCell((cell, colNumber) => {
        stripFormatting(cell)
        if (colNumber < maxCol) {
          collectCellErrors(errors, updateFn, r, [colNumber, rowNumber], cell)
        }
      })
      r['--rowNumber'] = rowNumber
      elements.push(r)
    }
  })
  return { elements, errors }
}

export const readExcelBuffer = async (buffer) => {
  logger.info('Starting parsing spreadsheet')
  try {
    const workbook = new Excel.Workbook()
    return await workbook.xlsx.load(buffer, {
      ignoreNodes: ['conditionalFormatting'] // breaks generated excel file
    })
  } catch {
    return null
  }
}

export const updateErrors = (() => {
  const font = { bold: true, size: 12, color: { argb: 'FFD4351C' }, name: 'Calibri' }
  const fillStyle = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCCCC' }, bgColor: { argb: 'FFFFD9D9' } }
  // prettier-ignore
  const colNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U',
                    'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK']
  const coordsToCellName = (coords) => ` (${colNames[coords[0] - 1]}${coords[1]})`

  const updateCell = (worksheet, coords, message, errCol) => {
    const [colNumber, rowNumber] = coords
    const row = worksheet.getRow(rowNumber)
    const cell = row.getCell(colNumber)
    const errorCell = row.getCell(errCol)
    if (errorCell) {
      errorCell.value = appendMessageToCell(errorCell, message + coordsToCellName(coords), font)
    }
    if (cell?.value) {
      cell.value = { richText: [{ font, text: cellValueText(cell.value) }] }
      cell.style.fill = { ...fillStyle }
    } else {
      cell.value = { richText: [{ font, text: 'Please provide a value' }] }
    }
  }
  return (workbook, cellsAndMessages, worksheetMetadata, logger) => {
    const l = logger || console
    for (const worksheetName of Object.keys(cellsAndMessages)) {
      const worksheet = workbook.getWorksheet(worksheetName)
      if (worksheet) {
        for (const { coords, message } of cellsAndMessages[worksheetName]) {
          updateCell(worksheet, coords, message, worksheetMetadata?.errors[worksheetName] ?? 1)
        }
      } else {
        l.log(
          `Cannot update errors - worksheet not fonud "${worksheetName}" not in ${workbook.worksheets.map((ws) => ws.name).join(', ')}`,
          JSON.stringify(cellsAndMessages)
        )
      }
    }
    return workbook
  }
})()

export const updateCellContent = (() => {
  const font = { bold: true, size: 12, color: { argb: '00000000' }, name: 'Calibri' }
  const updateCell = (worksheet, coords, value) => {
    const [colNumber, rowNumber] = coords
    const row = worksheet.getRow(rowNumber)
    const cell = row.getCell(colNumber)
    cell.value = { richText: [{ font, text: String(value ?? '') }] }
  }
  return (workbook, cellsAndValues) => {
    for (const worksheetName of Object.keys(cellsAndValues)) {
      const worksheet = workbook.getWorksheet(worksheetName)
      if (worksheet) {
        for (const { coords, value } of cellsAndValues[worksheetName]) {
          updateCell(worksheet, coords, value)
        }
      } else {
        console.log(
          `Cannot update cell content - worksheet not fonud "${worksheetName}" not in ${workbook.worksheets.map((ws) => ws.name).join(', ')}`,
          JSON.stringify(cellsAndValues)
        )
      }
    }
    return workbook
  }
})()

export const workbookToByteArray = async (workbook) => {
  /* v8 ignore start */
  if (config.get('bulkUpload.copySpreadsheetToDisk')) {
    const f = '/tmp/output-' + crypto.randomUUID() + '.xlsx' // nosonar
    logger.info(`file: ${f}`)
    await workbook.xlsx.writeFile(f)
  }
  /* v8 ignore stop */
  return await workbook.xlsx.writeBuffer()
}

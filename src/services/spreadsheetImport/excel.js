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
    const v = val.richText ?? val
    if (Array.isArray(v)) {
      return v.reduce((acc, x) => acc + plainText(x.richText ?? x), '')
    } else {
      return plainText(v)
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
  } catch (e) {
    errors.push(cellError(colNumber, rowNumber, e.message, null, cell.value))
  }
}

const MAX_CONSECUTIVE_EMPTY_ROWS = 100

export const worksheetToArray = ({ worksheet, keyCol, updateFn, minRow, maxCol }) => {
  const elements = []
  const errors = []
  let consecutiveEmptyRows = 0
  let stopIteration = false
  worksheet.eachRow((row, rowNumber) => {
    if (stopIteration || rowNumber <= minRow) {
      return
    }
    if (!row.getCell(keyCol).value) {
      consecutiveEmptyRows++
      if (consecutiveEmptyRows >= MAX_CONSECUTIVE_EMPTY_ROWS) {
        stopIteration = true
      }
      return
    }
    consecutiveEmptyRows = 0
    row.getCell(1).value = emptyCell()
    const r = {}
    row.eachCell((cell, colNumber) => {
      if (colNumber < maxCol) {
        stripFormatting(cell)
        collectCellErrors(errors, updateFn, r, [colNumber, rowNumber], cell)
      }
    })
    r['--rowNumber'] = rowNumber
    elements.push(r)
  })
  return { elements, errors }
}

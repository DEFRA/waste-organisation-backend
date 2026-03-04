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
  const richTextEntryToString = (x) => x?.text ?? ''
  return (val) => {
    const v = val?.richText ?? val
    if (Array.isArray(v)) {
      return v.reduce((acc, x) => acc + richTextEntryToString(x.richText ?? x), '')
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
  } catch (e) {
    errors.push(cellError(colNumber, rowNumber, e.message, null, cell.value))
  }
}

export const worksheetToArray = ({ worksheet, keyCol, updateFn, minRow, maxCol }) => {
  const elements = []
  const errors = []
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > minRow && row.getCell(keyCol).value) {
      row.getCell(1).value = emptyCell()
      const r = {}
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

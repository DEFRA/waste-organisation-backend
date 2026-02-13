import Excel from 'exceljs'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

const cellError = (colNumber, rowNumber, message) => ({
  coords: [colNumber, rowNumber],
  message
})

const cellValueText = (() => {
  const plainText = (x) => x?.text ?? x
  return (v) => {
    if (Array.isArray(v)) {
      return v.reduce((acc, x) => acc + plainText(x.richText ?? x), '')
    } else {
      return plainText(v)
    }
  }
})()

const stripFormatting = (cell) => {
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

const emptyErrorCell = () => ({ richText: [] })

const collectCellErrors = (
  errors,
  updateFn,
  r,
  [colNumber, rowNumber],
  cell
) => {
  try {
    updateFn(r, [colNumber, rowNumber], cellValueText(cell.value))
  } catch (e) {
    errors.push(cellError(colNumber, rowNumber, e.message))
  }
}

const worksheetToArray = ({ worksheet, keyCol, updateFn, minRow, maxCol }) => {
  const elements = []
  const errors = []
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > minRow && row.getCell(keyCol).value) {
      row.getCell(1).value = emptyErrorCell()
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

export const updateErrors = (() => {
  const font = {
    bold: true,
    size: 12,
    color: { argb: 'FFD4351C' },
    name: 'Calibri'
  }
  const fillStyle = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFCCCC' },
    bgColor: { argb: 'FFFFD9D9' }
  }
  const updateCell = (worksheet, coords, message) => {
    const [colNumber, rowNumber] = coords
    const row = worksheet.getRow(rowNumber)
    const cell = row.getCell(colNumber)
    const errorCell = row.getCell(1)
    if (errorCell) {
      const v = errorCell?.value?.richText ? errorCell?.value : { richText: [] }
      v.richText.push({
        font,
        text: v.richText.length > 0 ? '\n' : '' + message
      })
      errorCell.value = v
    }
    if (cell?.value) {
      cell.value = { richText: [{ font, text: cell.value }] }
      cell.style.fill = fillStyle
    }
  }
  return (workbook, cellsAndMessages) => {
    for (const worksheetName of Object.keys(cellsAndMessages)) {
      const worksheet = workbook.getWorksheet(worksheetName)
      for (const { coords, message } of cellsAndMessages[worksheetName]) {
        updateCell(worksheet, coords, message)
      }
    }
    return workbook
  }
})()

export const parseExcelFile = async (buffer) => {
  logger.info('Starting parsing spreadsheet')
  const workbook = new Excel.Workbook()
  await workbook.xlsx.load(buffer, {
    ignoreNodes: [
      // 'autoFilter',
      // 'cols',
      'conditionalFormatting' // breaks generated excel file
      // 'dataValidations',
      // 'dimension',
      // 'drawing',
      // 'extLst',
      // 'headerFooter',
      // 'hyperlinks',
      // 'mergeCells',
      // 'pageMargins',
      // 'pageSetup',
      // 'picture',
      // 'printOptions',
      // 'rowBreaks',
      // 'sheetData', // ignores actual data
      // 'sheetFormatPr',
      // 'sheetPr',
      // 'sheetProtection',
      // 'sheetViews',
      // 'tableParts'
    ]
  })
  const movements = worksheetToArray({
    worksheet: workbook.getWorksheet('7. Waste movement level'),
    keyCol: 3,
    minRow: 8,
    maxCol: 32,
    updateFn: movementColName
  })
  const items = worksheetToArray({
    worksheet: workbook.getWorksheet('8. Waste item level'),
    keyCol: 2,
    minRow: 8,
    maxCol: 25,
    updateFn: itemColName
  })
  const joined = joinWasteItems(movements.elements, items.elements)
  if (
    movements.errors.length > 0 ||
    items.errors.length > 0 ||
    joined.errors.length > 0
  ) {
    const errors = {
      '7. Waste movement level': movements.errors.concat(
        joined.errors.movements
      ),
      '8. Waste item level': items.errors.concat(joined.errors.items)
    }
    updateErrors(workbook, errors)
    return {
      errors,
      workbook
    }
  } else {
    return joined
  }
}

const joinWasteItems = (movements, items) => {
  const is = groupBy((x) => x['yourUniqueReference'], items)
  const errors = { movements: [], items: [] }
  for (let i = 0; i < movements.length; i++) {
    const r = movements[i]['yourUniqueReference']
    if (is[r] && is[r].length > 0) {
      movements[i].wasteItems = is[r].map((x) => {
        delete x['--rowNumber']
        return x
      })
      delete movements[i]['--rowNumber']
      delete is[r]
    } else {
      errors.movements.push(
        cellError(
          3,
          movements[i]['--rowNumber'],
          'No waste items for unique reference'
        )
      )
    }
  }
  if (Object.keys(is).length > 0) {
    for (const m of Object.values(is).flatMap((x) => x)) {
      errors.items.push(
        cellError(
          2,
          m['--rowNumber'],
          'No waste movements for unique reference'
        )
      )
    }
  }
  return { movements, errors }
}

const groupBy = (func, list) => {
  return list.reduce((acc, x) => {
    if (acc[func(x)] == null) {
      acc[func(x)] = []
    }
    acc[func(x)].push(x)
    return acc
  }, {})
}

const updateData = (cols) => {
  const updateIn = (data, path, v, func) => {
    path.reduce((acc, x, i) => {
      if (i === path.length - 1) {
        const value = func ? func(acc[x], v) : v
        acc[x] = value
      } else {
        if (acc[x] == null) {
          acc[x] = {}
        }
      }
      return acc[x]
    }, data)
    return data
  }

  return (r, [colNum, _rowNum], value) => {
    const cs = cols[colNum]
    if (typeof cs[cs.length - 1] === 'function') {
      updateIn(r, cs.slice(0, -1), value, cs[cs.length - 1])
    } else {
      updateIn(r, cs, value)
    }
    return r
  }
}

const parseComponentCodes = (existing, data) => {
  const result = existing ?? []
  try {
    result.concat(
      data.split(/;/).map((y) => {
        // eslint-disable-next-line no-unused-vars
        const [_, code, concentration] = y
          .match(/([^=]*)=(.*)/) // nosonar
          .map((x) => x.trim())
        return { code, concentration }
      })
    )
    return result
  } catch (e) {
    throw new Error('Cannot parse component codes')
  }
}

const parseComponentNames = (existing, data) => {
  const result = existing ?? []
  try {
    const parsed = data.split(/;/).flatMap((y) => {
      // eslint-disable-next-line no-unused-vars
      const [_, name, concentration] = y
        .match(/([^=]*)=(.*)/) // nosonar
        .map((x) => x.trim())
      return { code: name, concentration }
    })
    return result.concat(parsed)
  } catch (e) {
    throw new Error('Cannot parse component names')
  }
}

const mergeDate = (existing, data) => {
  if (!(data instanceof Date)) {
    throw new Error('Cannot parse date')
  }
  if (existing == null) {
    return data
  } else {
    const date = new Date(existing.getTime())
    date.setFullYear(data.getFullYear())
    date.setMonth(data.getMonth())
    date.setDate(data.getDate())
    return date
  }
}

const mergeTime = (existing, data) => {
  if (!(data instanceof Date)) {
    throw new Error('Cannot parse time')
  }
  if (existing == null) {
    return data
  } else {
    const date = new Date(existing.getTime())
    date.setHours(data.getHours())
    date.setMinutes(data.getMinutes())
    date.setSeconds(data.getSeconds())
    return date
  }
}

const parseDisposalCodes = (existing, data) => {
  const [code, metric, amount, est] = data.split(/=/).map((x) => x.trim())
  if (est) {
    const isEstimate = est.toLowerCase()
    return { code, weight: { metric, amount, isEstimate } }
  } else {
    throw new Error('Cannot parse disposal codes.')
  }
}

const movementColName = updateData([
  [],
  [],
  [],
  ['yourUniqueReference'],
  ['receiver', 'siteName'],
  ['receipt', 'address', 'fullAddress'],
  ['receipt', 'address', 'postcode'],
  ['receiver', 'authorisationNumber'],
  ['receiver', 'regulatoryPositionStatement'],
  ['receiver', 'emailAddress'],
  ['receiver', 'phoneNumber'],
  ['dateTimeReceived', mergeDate],
  ['dateTimeReceived', mergeTime],
  ['hazardousWasteConsignmentCode'],
  ['reasonForNoConsignmentCode'],
  ['specialHandlingRequirements'],
  ['carrier', 'registrationNumber'],
  ['carrier', 'reasonForNoRegistrationNumber'],
  ['carrier', 'organisationName'],
  ['carrier', 'address', 'fullAddress'],
  ['carrier', 'address', 'postcode'],
  ['carrier', 'emailAddress'],
  ['carrier', 'phoneNumber'],
  ['carrier', 'meansOfTransport'],
  ['carrier', 'vehicleRegistration'],
  ['brokerOrDealer', 'organisationName'],
  ['brokerOrDealer', 'address', 'fullAddress'],
  ['brokerOrDealer', 'address', 'postcode'],
  ['brokerOrDealer', 'emailAddress'],
  ['brokerOrDealer', 'phoneNumber'],
  ['brokerOrDealer', 'registrationNumber']
])

const itemColName = updateData([
  [],
  [],
  ['yourUniqueReference'],
  ['ewcCodes'],
  ['wasteDescription'],
  ['physicalForm'],
  ['numberOfContainers'],
  ['typeOfContainers'],
  ['weight', 'metric'],
  ['weight', 'amount'],
  ['weight', 'isEstimate'],
  ['containsPops'],
  ['pops', 'components', parseComponentCodes],
  ['pops', 'sourceOfComponents'],
  ['containsHazardous'],
  ['hazardous', 'hazCodes'],
  ['hazardous', 'components', parseComponentNames],
  ['hazardous', 'sourceOfComponents'],
  ['disposalOrRecoveryCodes', parseDisposalCodes]
])

/* v8 ignore start */
/* v8 ignore stop */

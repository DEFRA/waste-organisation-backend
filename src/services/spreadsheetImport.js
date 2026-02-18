import Excel from 'exceljs'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

const cellError = (colNumber, rowNumber, message, errorValue) => {
  const x = {
    coords: [colNumber, rowNumber],
    message
  }
  if (errorValue) {
    x.errorValue = errorValue
  }
  return x
}

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

const collectCellErrors = (errors, updateFn, r, [colNumber, rowNumber], cell) => {
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

const updateData = (cols) => {
  const updateIn = (data, path, v, func) => {
    if (path) {
      path.reduce((acc, x, i) => {
        // prettier-ignore
        if (i === path.length - 1) {
        const value = func ? func(acc[x], v) : v
        acc[x] = value
      } else if (acc[x] == null) { // nosonar
        acc[x] = {}
      }
        return acc[x]
      }, data)
    }
    return data
  }

  return (r, [colNum, _rowNum], value) => {
    const [cs, func] = cols[colNum]
    updateIn(r, cs, value, func)
    return r
  }
}

const joinWasteItems = (movements, items, defraCustomerOrganisationId) => {
  const is = groupBy((x) => x['yourUniqueReference'], items)
  const errors = { movements: [], items: [] }
  const movementRefCol = 3
  const itemRefCol = 2
  const rowNumbers = {}
  for (let i = 0; i < movements.length; i++) {
    const r = movements[i]['yourUniqueReference']
    rowNumbers[r] = { movementRow: movements[i]['--rowNumber'], itemRows: [] }
    if (is[r] && is[r].length > 0) {
      movements[i].submittingOrganisation = { defraCustomerOrganisationId }
      movements[i].wasteItems = is[r].map((x) => {
        rowNumbers[r].itemRows.push(x['--rowNumber'])
        delete x['--rowNumber']
        delete x['yourUniqueReference']
        return x
      })
      delete movements[i]['--rowNumber']
      delete is[r]
    } else {
      errors.movements.push(cellError(movementRefCol, movements[i]['--rowNumber'], 'No waste items for unique reference'))
    }
  }
  if (Object.keys(is).length > 0) {
    for (const m of Object.values(is).flatMap((x) => x)) {
      errors.items.push(cellError(itemRefCol, m['--rowNumber'], 'No waste movements for unique reference'))
    }
  }
  return { movements, errors, rowNumbers }
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

const distinct = (xs) => {
  const seen = new Set()
  return xs.filter((x) => {
    const r = seen.has(x)
    seen.add(x)
    return !r
  })
}

const parseComponentCodes = (existing, data) => {
  const result = existing ?? []
  try {
    result.concat(
      data.split(/;/).map((y) => {
        const [_, code, c] = y
          .match(/([^=]*)=(.*)/) // nosonar
          .map((x) => x.trim())
        return { code, concentration: c.match(/^([0-9.]+)$/) ? Number(c) : c }
      })
    )
    return result
  } catch {
    throw new Error('Cannot parse component codes')
  }
}

const parseComponentNames = (existing, data) => {
  const result = existing ?? []
  try {
    const parsed = data.split(/;/).flatMap((y) => {
      const [_, name, c] = y
        .match(/([^=]*)=(.*)/) // nosonar
        .map((x) => x.trim())
      return { name, concentration: c.match(/^([0-9.]+)$/) ? Number(c) : c }
    })
    return result.concat(parsed)
  } catch {
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

const parseEstimate = (() => {
  const estVals = ['estimate', 'est', 'y', 'yes', 'true', true, 'TRUE()']
  const actVals = ['actual', 'act', 'n', 'no', 'false', false, 'FALSE()']
  return (existing, est) => {
    if (est) {
      const e = typeof est === 'string' || est instanceof String ? est.toLowerCase() : (est.formula ?? est)
      if (estVals.includes(e)) {
        return true
      }
      if (actVals.includes(e)) {
        return false
      }
      return existing
    } else {
      throw new Error('Cannot parse estimate.')
    }
  }
})()

const parseBoolean = (() => {
  const trueVals = ['y', 'yes', 'true', true, 'TRUE()']
  const falseVals = ['n', 'no', 'false', false, 'FALSE()']
  return (existing, data) => {
    const e = typeof data === 'string' || data instanceof String ? data.toLowerCase() : (data.formula ?? data)
    if (trueVals.includes(e)) {
      return true
    }
    if (falseVals.includes(e)) {
      return false
    }
    return existing
  }
})()

const parseDisposalCodes = (() => {
  const metricConversions = {
    grams: 'Grams',
    kilograms: 'Kilograms',
    tonnes: 'Tonnes',
    g: 'Grams',
    kg: 'Kilograms',
    T: 'Tonnes'
  }
  const parseDC = (el) => {
    const [codeStr, amountStr, metricStr, est] = el.split(/=/).map((x) => x.trim())
    if (est) {
      const isEstimate = parseEstimate(null, est)
      const amount = amountStr?.match(/^[0-9,]+$/) ? Number(amountStr.replace(/,/g, '')) : amountStr
      const code = codeStr.replace(/^([A-Z])([0_ ]*)([1-9][0-9]*)$/, '$1$3')
      const metric = metricConversions[metricStr?.toLowerCase()] ?? metricStr
      return { code, weight: { metric, amount, isEstimate } }
    } else {
      throw new Error(`Cannot parse disposal / recovery codes (${el})`)
    }
  }
  return (existing, data) => {
    const result = existing ?? []
    return result.concat(data.split(/;/).map(parseDC))
  }
})()

const parseEWCCodes = (existing, data) => {
  const result = existing ?? []
  try {
    return result.concat(data.split(/[,;]/).map((y) => y.replace(/[^0-9]/g, '')))
  } catch {
    throw new Error('Cannot parse EWC codes')
  }
}

const parseHazCodes = (existing, data) => {
  const result = existing ?? []
  try {
    return result.concat(data.split(/[,;]/).map((y) => y.trim().replace(/^HP([0_ ]*)([1-9][0-9]*)$/, 'HP_$2')))
  } catch {
    throw new Error('Cannot parse Haz codes')
  }
}

const parseContainerType = (existing, data) => {
  const c = typeof data === 'string' || data instanceof String ? data.toUpperCase() : null
  if (c) {
    return c.replace(/^\[([A-Z]+)\].*$/, '$1')
  }
  return existing
}

const parseToString = (existing, data) => {
  return data ? data.toString() : existing
}

const movementMapping = [
  [],
  [],
  [],
  [['yourUniqueReference']],
  [['receiver', 'siteName']],
  [['receipt', 'address', 'fullAddress']],
  [['receipt', 'address', 'postcode']],
  [['receiver', 'authorisationNumber'], parseToString],
  [['receiver', 'regulatoryPositionStatement']],
  [['receiver', 'emailAddress']],
  [['receiver', 'phoneNumber']],
  [['dateTimeReceived'], mergeDate],
  [['dateTimeReceived'], mergeTime],
  [['hazardousWasteConsignmentCode']],
  [['reasonForNoConsignmentCode']],
  [['specialHandlingRequirements']],
  [['carrier', 'registrationNumber']],
  [['carrier', 'reasonForNoRegistrationNumber']],
  [['carrier', 'organisationName']],
  [['carrier', 'address', 'fullAddress']],
  [['carrier', 'address', 'postcode']],
  [['carrier', 'emailAddress']],
  [['carrier', 'phoneNumber']],
  [['carrier', 'meansOfTransport']],
  [['carrier', 'vehicleRegistration']],
  [['brokerOrDealer', 'organisationName']],
  [['brokerOrDealer', 'address', 'fullAddress']],
  [['brokerOrDealer', 'address', 'postcode']],
  [['brokerOrDealer', 'emailAddress']],
  [['brokerOrDealer', 'phoneNumber']],
  [['brokerOrDealer', 'registrationNumber']]
]

const itemMapping = [
  [],
  [],
  [['yourUniqueReference']],
  [['ewcCodes'], parseEWCCodes],
  [['wasteDescription']],
  [['physicalForm']],
  [['numberOfContainers']],
  [['typeOfContainers'], parseContainerType],
  [['weight', 'metric']],
  [['weight', 'amount']],
  [['weight', 'isEstimate'], parseEstimate],
  [['containsPops'], parseBoolean],
  [['pops', 'components'], parseComponentCodes],
  [['pops', 'sourceOfComponents']],
  [['containsHazardous'], parseBoolean],
  [['hazardous', 'hazCodes'], parseHazCodes],
  [['hazardous', 'components'], parseComponentNames],
  [['hazardous', 'sourceOfComponents']],
  [['disposalOrRecoveryCodes'], parseDisposalCodes]
]

export const parseExcelFile = (() => {
  const movementColName = updateData(movementMapping)
  const itemColName = updateData(itemMapping)

  return async (buffer, defraCustomerOrganisationId) => {
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
    const joined = joinWasteItems(movements.elements, items.elements, defraCustomerOrganisationId)
    if (movements.errors.length > 0 || items.errors.length > 0 || joined.errors.items.length > 0 || joined.errors.movements.length > 0) {
      const errors = {
        '7. Waste movement level': movements.errors.concat(joined.errors.movements),
        '8. Waste item level': items.errors.concat(joined.errors.items)
      }
      updateErrors(workbook, errors)
      return {
        errors,
        workbook,
        movements: joined.movements,
        rowNumbers: joined.rowNumbers
      }
    } else {
      return joined
    }
  }
})()

export const errorToCoords = (() => {
  const cleanErrorMessage = ({ message, key }) => {
    const name = key
      .split('.')
      .reduce((n, x) => (x.match(/^[0-9]+$/) ? n : x), '')
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .toLowerCase()
    return message.replace(/^"[^"]*"/, name)
  }

  const keyPathToColNum = (path, mappings) => {
    const numIdx = path.findIndex((x) => x.match(/^[0-9]+$/))
    const p = numIdx >= 0 ? path.slice(0, numIdx + 1) : path
    return mappings.findIndex((x) => x[0]?.every((y, i) => y == p[i]))
  }

  const wasteMovementErr = (movementData, idx, rowNumbers, errKeyPath, error) => {
    const ref = movementData[idx]?.yourUniqueReference
    const msg = cleanErrorMessage(error)
    const colNum = keyPathToColNum(errKeyPath.slice(1), movementMapping)
    const errorValue = movementMapping[colNum][0].reduce((x, y) => x[y], movementData[idx])
    return cellError(rowNumbers[ref].movementRow, colNum, msg, errorValue)
  }

  const wasteItemErr = (movementData, movementIdx, itemIdx, rowNumbers, errKeyPath, error) => {
    const ref = movementData[movementIdx]?.yourUniqueReference
    const msg = cleanErrorMessage(error)
    const colNum = keyPathToColNum(errKeyPath.slice(3), itemMapping)
    const errorValue = itemMapping[colNum][0].reduce((x, y) => x[y], movementData[movementIdx].wasteItems[itemIdx])
    return cellError(rowNumbers[ref].itemRows[itemIdx], colNum, msg, errorValue)
  }

  return (movementData, rowNumbers, error) => {
    const errKeyPath = error.key.split('.')
    if (errKeyPath[0].match(/^[0-9]+$/)) {
      if (errKeyPath[1] === 'wasteItems' && errKeyPath[2].match(/^[0-9]+$/)) {
        return wasteItemErr(movementData, errKeyPath[0], errKeyPath[2], rowNumbers, errKeyPath, error)
      } else {
        return wasteMovementErr(movementData, errKeyPath[0], rowNumbers, errKeyPath, error)
      }
    }
    return cellError(1, 9, error.message)
  }
})()

export const transformBulkApiErrors = (movementData, rowNumbers, errors) => distinct(errors.map((e) => errorToCoords(movementData, rowNumbers, e)))

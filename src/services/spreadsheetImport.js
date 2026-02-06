import Excel from 'exceljs'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

const worksheetToArray = ({ worksheet, keyCol, updateFn, minRow, maxCol }) => {
  const a = []
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > minRow) {
      if (row.getCell(keyCol).value) {
        const r = {}
        row.eachCell((cell, colNumber) => {
          if (colNumber < maxCol) {
            updateFn(r, colNumber, rowNumber, cell.value)
          }
        })
        a.push(r)
      }
    }
  })
  return a
}

export const parseExcelFile = async (buffer) => {
  const workbook = new Excel.Workbook()
  await workbook.xlsx.load(buffer, {
    ignoreNodes: [
      'autoFilter',
      'cols',
      'conditionalFormatting',
      'dataValidations',
      'dimension',
      'drawing',
      'extLst',
      'headerFooter',
      'hyperlinks',
      'mergeCells',
      'pageMargins',
      'pageSetup',
      'picture',
      'printOptions',
      'rowBreaks',
      // 'sheetData', // ignores actual data
      'sheetFormatPr',
      'sheetPr',
      'sheetProtection',
      'sheetViews',
      'tableParts'
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
  return { movements, items }
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

const identity = (x) => x

const updateData = (cols) => {
  // updateFn(r, colNumber, rowNumber, cell.value)

  // r[colFunc(colNumber)] = {
  //   value: cell.value,
  //   coords: [colNumber, rowNumber]
  // }

  return (colNum) => {
    if (typeof cols[cols.length - 1] === 'function') {
      return
    } else {
      return cols[colNum]
    }
  }
}

const parseComponents = (existing, data) => {
  const result = existing ?? []
  return result
}

const mergeDate = (existing, data) => {
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
  const isEstimate = est.toLowerCase()
  return { code, weight: { metric, amount, isEstimate } }
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
  ['pops', 'components', parseComponents],
  ['pops', 'sourceOfComponents'],
  ['containsHazardous'],
  ['hazardous', 'hazCodes'],
  ['hazardous', 'components', parseComponents],
  ['hazardous', 'sourceOfComponents'],
  ['disposalOrRecoveryCodes', parseDisposalCodes]
])

export const dataToRequest = ({ items, movements }) => {
  const is = groupBy((x) => x[0].value, items)
  for (const m of movements) {
    m.wasteItems = is[m['yourUniqueReference']]
  }
  return m
}

/* v8 ignore start */
/* v8 ignore stop */

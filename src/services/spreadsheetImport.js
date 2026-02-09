import Excel from 'exceljs'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()

const worksheetToArray = ({ worksheet, keyCol, updateFn, minRow, maxCol }) => {
  const elements = []
  let errorOccured = false
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > minRow) {
      if (row.getCell(keyCol).value) {
        const r = {}
        row.eachCell((cell, colNumber) => {
          if (colNumber < maxCol) {
            try {
              updateFn(r, colNumber, rowNumber, cell.value)
            } catch (e) {
              errorOccured = true
              updateError(worksheet, cell, e.message)
            }
          }
        })
        elements.push(r)
      }
    }
  })
  return elements
}

const updateError = (worksheet, cell, message) => {
  console.log('error message: ', message)
  return worksheet, cell, message
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
  return joinWasteItems(movements, items)
}

const joinWasteItems = (movements, items) => {
  const is = groupBy((x) => x['yourUniqueReference'], items)
  for (let i = 0; i < movements.length; i++) {
    const r = movements[i]['yourUniqueReference']
    movements[i].wasteItems = is[r]
    delete is[r]
  }
  return { movements }
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
  let path = ['hazardous', 'sourceOfComponents']

  let updateIn = (data, path, v, coords, func) => {
    path.reduce((acc, x, i) => {
      if (i === path.length - 1) {
        // const value = func ? func(acc[x]?.value, v) : v
        // acc[x] = { value, coords }
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

  return (r, colNum, rowNum, value) => {
    // console.log('cols[colNum]: ', cols[colNum])
    const cs = cols[colNum]
    if (typeof cs[cs.length - 1] === 'function') {
      // const f = cols[cols.length - 1]
      // const dataPath = cols[0,-1]
      // const v = f(r[], value)
      // console.log('cs[cs.length - 1]: ', cs[cs.length - 1])
      updateIn(r, cs.slice(0, -1), value, [colNum, rowNum], cs[cs.length - 1])
      return r
    } else {
      updateIn(r, cs, value, [colNum, rowNum])
      return r
    }
  }
}

const parseComponentCodes = (existing, data) => {
  const result = existing ?? []
  result.concat(
    data.split(/;/).map((y) => {
      const [_, code, concentration] = y
        .match(/([^=]*)=(.*)/)
        .map((x) => x.trim())
      return { code, concentration }
    })
  )
  return result
}

const parseComponentNames = (existing, data) => {
  const result = existing ?? []
  const parsed = data.split(/;/).flatMap((y) => {
    const [_, name, concentration] = y
      .match(/([^=]*)=(.*)/)
      .map((x) => x.trim())
    return { code: name, concentration }
  })
  return result.concat(parsed)
}

const mergeDate = (existing, data) => {
  if ((!data) instanceof Date) {
    throw new Exception('Cannot parse date')
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
  if ((!data) instanceof Date) {
    throw new Exception('Cannot parse date')
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

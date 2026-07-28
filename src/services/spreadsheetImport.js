import {
  correctDateTimezone,
  parseBoolean,
  parseComponentCodes,
  parseComponentNames,
  parseContainerType,
  parseDisposalCodes,
  parseEstimate,
  parseEWCCodes,
  parseHazCodes,
  parseRegStatements,
  parseTitleCase,
  parseToNumber,
  parseToString,
  requiredString
} from './spreadsheetImport/parsers.js'
import {
  readExcelBuffer,
  cellError,
  collectCellErrors,
  worksheetToArray,
  cellValueText,
  updateErrors as xlUpdateErrors,
  updateCellContent as xlUpdateCellContent,
  workbookToByteArray as xlWorkbookToByteArray
} from './spreadsheetImport/excel.js'
import { compose, coerceRegistrationNumberWhenReasonSupplied, validateMovementHasWasteItems, validateUniqueReference } from './spreadsheetImport/transforms.js'

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

const joinWasteItems = (movements, items, { firstRowOfDataInSpreadsheet, movementWorksheetName }, defraCustomerOrganisationId, transform) => {
  const is = Object.groupBy(items, (x) => x['yourUniqueReference'])
  const errors = { movements: [], items: [] }
  const wasteTrackingIdCol = 2
  const itemRefCol = 2
  const movementRefCol = 3
  const rowNumbers = {}
  for (let i = 0; i < movements.length; i++) {
    const r = movements[i]['yourUniqueReference']
    rowNumbers[r] = { movementRow: movements[i]['--rowNumber'], itemRows: [] }
    if (r && is[r] && is[r].length > 0) {
      movements[i].submittingOrganisation = { defraCustomerOrganisationId }
      movements[i].wasteItems = is[r].map((x) => {
        rowNumbers[r].itemRows.push(x['--rowNumber'])
        delete x['--rowNumber']
        delete x['yourUniqueReference']
        return x
      })
    }
    // WARNING: mutabliy updates movements array from supplied transform
    collectCellErrors(errors.movements, () => (movements[i] = transform(movements[i])), null, [wasteTrackingIdCol, movements[i]['--rowNumber']], {}) // nosonar
    delete movements[i]['--rowNumber']
    if (r) {
      delete is[r]
    }
  }
  if (movements.length === 0) {
    errors.movements.push(cellError(movementRefCol, firstRowOfDataInSpreadsheet, 'No movements recognised', movementWorksheetName))
  }
  if (Object.keys(is).length > 0) {
    for (const i of Object.values(is).flatMap((x) => x)) {
      if (i['yourUniqueReference']) {
        errors.items.push(cellError(itemRefCol, i['--rowNumber'], 'No waste movements for unique reference'))
      }
    }
  }
  return { movements, errors, rowNumbers }
}

const distinct = (xs) => {
  const seen = new Set()
  return xs.filter((x) => {
    const key = JSON.stringify(x)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

const movementMapping = [
  [],
  [],
  [['wasteTrackingId'], parseToString],
  [['yourUniqueReference'], requiredString],
  [['receiver', 'siteName'], parseToString],
  [['receipt', 'address', 'fullAddress'], parseToString],
  [['receipt', 'address', 'postcode'], parseToString],
  [['receiver', 'authorisationNumber'], parseToString],
  [['receiver', 'regulatoryPositionStatements'], parseRegStatements],
  [['receiver', 'emailAddress'], parseToString],
  [['receiver', 'phoneNumber'], parseToString],
  [['dateTimeReceived'], correctDateTimezone],
  [['hazardousWasteConsignmentCode'], parseToString],
  [['reasonForNoConsignmentCode'], parseToString],
  [['specialHandlingRequirements'], parseToString],
  [['carrier', 'registrationNumber'], parseToString],
  [['carrier', 'reasonForNoRegistrationNumber'], parseToString],
  [['carrier', 'organisationName'], parseToString],
  [['carrier', 'address', 'fullAddress'], parseToString],
  [['carrier', 'address', 'postcode'], parseToString],
  [['carrier', 'emailAddress'], parseToString],
  [['carrier', 'phoneNumber'], parseToString],
  [['carrier', 'meansOfTransport'], parseTitleCase],
  [['carrier', 'vehicleRegistration'], parseToString],
  [['brokerOrDealer', 'organisationName'], parseToString],
  [['brokerOrDealer', 'address', 'fullAddress'], parseToString],
  [['brokerOrDealer', 'address', 'postcode'], parseToString],
  [['brokerOrDealer', 'emailAddress'], parseToString],
  [['brokerOrDealer', 'phoneNumber'], parseToString],
  [['brokerOrDealer', 'registrationNumber'], parseToString]
]

const itemMapping = [
  [],
  [],
  [['yourUniqueReference'], requiredString],
  [['ewcCodes'], parseEWCCodes],
  [['wasteDescription'], parseToString],
  [['physicalForm'], parseTitleCase],
  [['numberOfContainers'], parseToNumber],
  [['typeOfContainers'], parseContainerType],
  [['weight', 'metric'], parseTitleCase],
  [['weight', 'amount'], parseToNumber],
  [['weight', 'isEstimate'], parseEstimate],
  [['containsPops'], parseBoolean],
  [['pops', 'components'], parseComponentCodes],
  [['pops', 'sourceOfComponents'], parseToString],
  [['containsHazardous'], parseBoolean],
  [['hazardous', 'hazCodes'], parseHazCodes],
  [['hazardous', 'components'], parseComponentNames],
  [['hazardous', 'sourceOfComponents'], parseToString],
  [['disposalOrRecoveryCodes'], parseDisposalCodes]
]

const getWorksheetMeta = (() => {
  const knownTemplateVersions = {
    'Report receipt of waste': {
      firstRowOfDataInSpreadsheet: 9,
      movementWorksheetName: '7. Waste movement level',
      itemWorksheetName: '8. Waste item level',
      movementColName: updateData(movementMapping),
      itemColName: updateData(itemMapping),
      transform: compose(coerceRegistrationNumberWhenReasonSupplied, validateMovementHasWasteItems)
    }
  }
  return (workbook) => {
    const templateKey = cellValueText(workbook.getWorksheet(workbook.worksheets[0].name).getRow(1).getCell(1).value)
    const metadata = knownTemplateVersions[templateKey]
    if (metadata == null) {
      throw new Error(`Unknown template key - '${templateKey}' taken from worksheet named '${workbook.worksheets[0].name}'`)
    }
    return metadata
  }
})()

export const parseExcelFile = (() => {
  return async (buffer, defraCustomerOrganisationId, logger, validateFn) => {
    const workbook = await readExcelBuffer(buffer)
    if (workbook == null) {
      return { hasErrors: true }
    }
    const worksheetMetadata = getWorksheetMeta(workbook)
    if (workbook.getWorksheet(worksheetMetadata.movementWorksheetName) == null || workbook.getWorksheet(worksheetMetadata.itemWorksheetName) == null) {
      logger.error(`Excel Workbook lacks the correct worksheets: ${workbook.worksheets.map((ws) => ws.name).join(', ')}`)
      return { hasErrors: true }
    }
    const movements = worksheetToArray({
      worksheet: workbook.getWorksheet(worksheetMetadata.movementWorksheetName),
      keyCols: [3, 4, 5, 6, 7], // nosonar
      minRow: 8,
      maxCol: movementMapping.length,
      updateFn: worksheetMetadata.movementColName
    })
    const items = worksheetToArray({
      worksheet: workbook.getWorksheet(worksheetMetadata.itemWorksheetName),
      keyCols: [2, 3, 4, 5, 6, 7, 8, 9], // nosonar
      minRow: 8,
      maxCol: itemMapping.length,
      updateFn: worksheetMetadata.itemColName
    })
    const joined = joinWasteItems(
      movements.elements,
      items.elements,
      worksheetMetadata,
      defraCustomerOrganisationId,
      compose(validateFn, worksheetMetadata.transform, validateUniqueReference()) // TODO can move validateUniqueReference() into spreadsheet -> metadata call?
    )
    logger.trace(`joined excel data: ${JSON.stringify(joined, null, 4)}`)
    if (movements.errors.length > 0 || items.errors.length > 0 || joined.errors.items.length > 0 || joined.errors.movements.length > 0) {
      const errors = {
        [worksheetMetadata.movementWorksheetName]: distinct(movements.errors.concat(joined.errors.movements)),
        [worksheetMetadata.itemWorksheetName]: distinct(items.errors.concat(joined.errors.items))
      }
      xlUpdateErrors(workbook, errors)
      return {
        hasErrors: true,
        errors,
        workbook,
        movements: joined.movements,
        rowNumbers: joined.rowNumbers,
        worksheetMetadata
      }
    } else {
      return { hasErrors: false, workbook, worksheetMetadata, ...joined }
    }
  }
})()

const errorToCoords = (() => {
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
    return mappings.findIndex((x) => {
      if (x[0]) {
        const cnt = Math.min(x[0].length, p.length)
        for (let c = 0; c < cnt; c++) {
          if (p[c] !== x[0][c]) {
            return false
          }
        }
        return true
      } else {
        return false
      }
    })
  }

  const wasteMovementErr = (movementData, idx, rowNumbers, errKeyPath, error, movementWorksheetName) => {
    const ref = movementData[idx]?.yourUniqueReference
    const msg = cleanErrorMessage(error)
    const colNum = keyPathToColNum(errKeyPath.slice(1), movementMapping)
    if (colNum < 0) {
      return {}
    }
    const errorValue = movementMapping[colNum][0].reduce((x, y) => x[y], movementData[idx])
    return cellError(colNum, rowNumbers[ref].movementRow, msg, movementWorksheetName, errorValue)
  }

  const wasteItemErr = (movementData, movementIdx, itemIdx, rowNumbers, errKeyPath, error, itemWorksheetName) => {
    const ref = movementData[movementIdx]?.yourUniqueReference
    const msg = cleanErrorMessage(error)
    // prettier-ignore
    const colNum = keyPathToColNum(errKeyPath.slice(3), itemMapping) // nosonar
    if (colNum < 0) {
      return {}
    }
    const wis = movementData[movementIdx]?.wasteItems
    const errorValue = itemMapping[colNum][0].reduce((x, y) => (x ? x[y] : null), wis ? wis[itemIdx] : null)
    return cellError(colNum, rowNumbers[ref].itemRows[itemIdx], msg, itemWorksheetName, errorValue)
  }

  const movementRefCol = 3

  return (movementData, rowNumbers, { firstRowOfDataInSpreadsheet, movementWorksheetName, itemWorksheetName }, error) => {
    const errKeyPath = error.key.split('.')
    if (errKeyPath[0].match(/^[0-9]+$/)) {
      let err
      if (errKeyPath[1] === 'wasteItems' && errKeyPath[2].match(/^[0-9]+$/)) {
        err = wasteItemErr(movementData, errKeyPath[0], errKeyPath[2], rowNumbers, errKeyPath, error, itemWorksheetName)
      } else {
        err = wasteMovementErr(movementData, errKeyPath[0], rowNumbers, errKeyPath, error, movementWorksheetName)
      }
      if (err?.coords) {
        return err
      }
    }
    return cellError(movementRefCol, firstRowOfDataInSpreadsheet, error.message, movementWorksheetName)
  }
})()

export const transformBulkApiErrors = (movementData, rowNumbers, worksheetMetadata, errors) =>
  Object.groupBy(distinct(errors.map((e) => errorToCoords(movementData, rowNumbers, worksheetMetadata, e))), ({ sheet }) => sheet)

export const wasteTrackingIdsToCoords = (movementData, rowNumbers, wasteTrackingIds, { movementWorksheetName }) => {
  return {
    [movementWorksheetName]: wasteTrackingIds.map(({ wasteTrackingId }, idx) => {
      const { movementRow } = rowNumbers[movementData[idx]['yourUniqueReference']]
      return {
        coords: [2, movementRow],
        value: wasteTrackingId,
        sheet: movementWorksheetName
      }
    })
  }
}

// alias these function so I don't have to refactor everthing at once
export const updateErrors = (worksheet, coords, message) => {
  return xlUpdateErrors(worksheet, coords, message)
}
export const updateCellContent = (workbook, cellsAndValues) => {
  return xlUpdateCellContent(workbook, cellsAndValues)
}
export const workbookToByteArray = (workbook) => {
  return xlWorkbookToByteArray(workbook)
}

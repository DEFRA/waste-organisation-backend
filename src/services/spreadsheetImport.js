import {
  readExcelBuffer,
  cellError,
  collectCellErrors,
  worksheetToArray,
  updateErrors as xlUpdateErrors,
  updateCellContent as xlUpdateCellContent,
  workbookToByteArray as xlWorkbookToByteArray
} from './spreadsheetImport/excel.js'
import { updateIn, getIn, deleteLeaf, distinct } from './spreadsheetImport/utils.js'
import { getWorksheetMeta } from './spreadsheetImport/worksheetMetadata.js'

export const joinWasteItems = (flatData, worksheetMetadata) => {
  const transform = worksheetMetadata.transform
  const errorWorksheet = worksheetMetadata.worksheets[worksheetMetadata.defaultErrorWorksheet]
  const errors = {}
  const rowNumbers = {}
  const extractedData = Object.entries(flatData).reduce((x, [k, { elements }]) => {
    x[k] = elements
    return x
  }, {})
  const updateRowNumber = (r, rowNames, joinKey) => {
    return (x) => {
      rowNumbers[r][rowNames[1]].push(x['--rowNumber'])
      delete x['--rowNumber']
      deleteLeaf(x, joinKey)
      return x
    }
  }

  const processJoinData = (data, intoKey, is, i, joinDefinition) => {
    const { joinKey, target, rowNames, process } = joinDefinition
    const r = getIn(data[intoKey][i], joinKey)
    rowNumbers[r] = { [rowNames[0]]: data[intoKey][i]['--rowNumber'], [rowNames[1]]: [] }
    if (r && is[r] && is[r].length > 0) {
      if (typeof process === 'function') {
        data[intoKey][i] = process(data[intoKey][i])
      }
      updateIn(data[intoKey][i], target, is[r].map(updateRowNumber(r, rowNames, joinKey)))
    }
    // WARNING: mutabliy updates movements array from supplied transform
    collectCellErrors(errors[intoKey], () => (data[intoKey][i] = transform(data[intoKey][i])), null, [null, data[intoKey][i]['--rowNumber']], {}) // nosonar
    delete data[intoKey][i]['--rowNumber']
    if (r) {
      delete is[r]
    }
  }

  const rf = (data, joinDefinition) => {
    const { joinKey, keys, refCols } = joinDefinition
    const [intoKey, fromKey] = keys
    keys.reduce((e, k) => {
      if (e[k] == null) {
        e[k] = []
      }
      return e
    }, errors)
    const is = Object.groupBy(data[fromKey], (x) => getIn(x, joinKey))
    const [trunkRefCol, branchRefCol] = refCols
    for (let i = 0; i < data[intoKey].length; i++) {
      processJoinData(data, intoKey, is, i, joinDefinition)
    }
    if (data[intoKey].length === 0) {
      errors[intoKey].push(cellError(trunkRefCol, errorWorksheet.firstRowOfData, 'No movements recognised', errorWorksheet.worksheetName))
    }
    if (Object.keys(is).length > 0) {
      for (const i of Object.values(is).flatMap((x) => x)) {
        if (getIn(i, joinKey)) {
          errors.items.push(cellError(branchRefCol, i['--rowNumber'], 'No waste movements for unique reference'))
        }
      }
    }
    return { ...data, errors, rowNumbers }
  }

  if (Array.isArray(worksheetMetadata.joins) && worksheetMetadata.joins.length > 0) {
    return worksheetMetadata.joins.reduce(rf, extractedData)
  } else {
    return Object.entries(flatData).reduce((data, [k, { elements }]) => {
      data[k] = elements
      return { ...data, errors, rowNumbers }
    }, {})
  }
}

export const parseExcelFile = (() => {
  return async (buffer, defraCustomerOrganisationId, logger, validateFn) => {
    const workbook = await readExcelBuffer(buffer, logger)
    if (workbook == null) {
      return { hasErrors: true }
    }
    const worksheetMetadata = getWorksheetMeta(workbook, validateFn, defraCustomerOrganisationId, logger)
    if (worksheetMetadata == null) {
      return { hasErrors: true }
    }
    const flatData = Object.values(worksheetMetadata.worksheets).reduce((result, metadata) => {
      result[metadata.target] = worksheetToArray({
        worksheet: workbook.getWorksheet(metadata.worksheetName),
        minRow: metadata.firstRowOfData - 1,
        ...metadata
      })
      return result
    }, {})
    const joined = joinWasteItems(flatData, worksheetMetadata)
    // logger.trace(`joined excel data: ${JSON.stringify(joined, null, 4)}`)
    // TODO get keys from metadata
    if (flatData.movements.errors.length > 0 || flatData.items.errors.length > 0 || joined.errors.items.length > 0 || joined.errors.movements.length > 0) {
      const errors = Object.values(worksheetMetadata.worksheets).reduce((errs, metadata) => {
        errs[metadata.worksheetName] = distinct(flatData[metadata.target].errors.concat(joined.errors[metadata.target]))
        return errs
      }, {})
      xlUpdateErrors(workbook, errors, worksheetMetadata)
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

  const wasteMovementErr = (movementData, idx, rowNumbers, errKeyPath, error, movementWorksheetName, joinKey, movementMapping) => {
    const ref = getIn(movementData[idx], joinKey)
    const msg = cleanErrorMessage(error)
    const colNum = keyPathToColNum(errKeyPath.slice(1), movementMapping)
    if (colNum < 0) {
      return {}
    }
    const errorValue = movementMapping[colNum][0].reduce((x, y) => x[y], movementData[idx])
    return cellError(colNum, rowNumbers[ref].movementRow, msg, movementWorksheetName, errorValue)
  }

  const wasteItemErr = (movementData, movementIdx, itemIdx, rowNumbers, errKeyPath, error, itemWorksheetName, joinKey, itemMapping) => {
    // const ref = movementData[movementIdx]?.yourUniqueReference
    const ref = getIn(movementData[movementIdx], joinKey)
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

  return (movementData, rowNumbers, { defaultErrorWorksheet, worksheets, errorTargets }, error) => {
    const errKeyPath = error.key.split('.')
    if (errKeyPath[0].match(/^[0-9]+$/)) {
      const joinErrorTarget = errorTargets.reduce((err, errTarget) => {
        if (err?.coords) {
          return err
        }
        if (errKeyPath[1] === errTarget.target[0] && errKeyPath[2].match(/^[0-9]+$/)) {
          return wasteItemErr(
            movementData,
            errKeyPath[0],
            errKeyPath[2],
            rowNumbers,
            errKeyPath,
            error,
            errTarget.worksheetName,
            errTarget.joinKey,
            worksheets[errTarget.worksheetName].mapping
          )
        } else {
          if (Array.isArray(errTarget.target) && errTarget.target.length === 0) {
            const e = wasteMovementErr(
              movementData,
              errKeyPath[0],
              rowNumbers,
              errKeyPath,
              error,
              errTarget.worksheetName,
              errTarget.joinKey,
              worksheets[errTarget.worksheetName].mapping
            )
            return e
          }
        }
        return err
      }, {})
      if (joinErrorTarget?.coords) {
        return joinErrorTarget
      }
    }
    return cellError(worksheets[defaultErrorWorksheet].defaultErrorCol, worksheets[defaultErrorWorksheet].firstRowOfData, error.message, defaultErrorWorksheet)
  }
})()

export const transformBulkApiErrors = (movementData, rowNumbers, worksheetMetadata, errors) =>
  Object.groupBy(distinct(errors.map((e) => errorToCoords(movementData, rowNumbers, worksheetMetadata, e))), ({ sheet }) => sheet)

export const wasteTrackingIdsToCoords = (movementData, rowNumbers, apiResultData, { copyFromResult }) =>
  copyFromResult.reduce((result, { source, target }) => {
    if (result[[target.worksheetName]] == null) {
      result[target.worksheetName] = []
    }
    result[target.worksheetName].push(
      ...apiResultData.flatMap((obj, idx) => {
        const wasteTrackingId = getIn(obj, source)
        if (movementData[idx] == null) {
          return []
        }
        const { movementRow } = rowNumbers[movementData[idx]['yourUniqueReference']] // TODO take join key as arg
        return [
          {
            coords: [target.col, movementRow],
            value: wasteTrackingId,
            sheet: target.worksheetName
          }
        ]
      })
    )
    return result
  }, {})

// alias these function so I don't have to refactor everthing at once
export const updateErrors = (worksheet, coords, worksheetMetadata, logger) => {
  return xlUpdateErrors(worksheet, coords, worksheetMetadata, logger)
}
export const updateCellContent = (workbook, cellsAndValues, worksheetMetadata, logger) => {
  return xlUpdateCellContent(workbook, cellsAndValues, worksheetMetadata, logger)
}
export const workbookToByteArray = (workbook, logger) => {
  return xlWorkbookToByteArray(workbook, logger)
}

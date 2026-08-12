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
import {
  compose,
  coerceRegistrationNumberWhenReasonSupplied,
  validateMovementHasWasteItems,
  validateUniqueReference,
  populateWholeItemDisposalCodes
} from './spreadsheetImport/transforms.js'

const getIn = (obj, path) => path?.reduce((x, k) => x && x[k], obj)

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

const deleteLeaf = (data, path) => {
  if (path) {
    path.reduce((acc, x, i) => {
      // prettier-ignore
      if (i === path.length - 1) {
        delete acc[x]
      } else if (acc == null || acc[x] == null) { // nosonar
        return null
      }
      return acc[x]
    }, data)
  }
  return data
}

const updateData = (cols) => {
  return (r, [colNum, _rowNum], value) => {
    const [cs, func] = cols[colNum]
    updateIn(r, cs, value, func)
    return r
  }
}

// joins: [{ joinKey: ['yourUniqueReference'], keys: ['movements', 'items'], target: ['wasteItems'], rowNames: ['movementRow', 'itemRow'] }]

const joinWasteItems = (flatData, worksheetMetadata, defraCustomerOrganisationId) => {
  const transform = worksheetMetadata.transform
  const errorWorksheet = worksheetMetadata.worksheets[worksheetMetadata.defaultErrorWorksheet]
  const errors = {}
  const rowNumbers = {}
  if (Array.isArray(worksheetMetadata.joins) && worksheetMetadata.joins.length > 0) {
    return worksheetMetadata.joins.reduce((data, { joinKey, keys, target, rowNames }) => {
      // TODO joinKey is an array??
      const [intoKey, fromKey] = keys
      keys.reduce((e, k) => {
        if (e[k] == null) {
          e[k] = []
        }
        return e
      }, errors)
      const is = Object.groupBy(data[fromKey].elements, (x) => getIn(x, joinKey))
      // TODO do we need wasteTrackingIdCol if the validation func knows the right col??
      const itemRefCol = 2 // TODO are itemRefCol and movementRefCol retrievable from worksheetMetadata?
      const movementRefCol = 3
      for (let i = 0; i < data[intoKey].elements.length; i++) {
        const r = getIn(data[intoKey].elements[i], joinKey)
        rowNumbers[r] = { [rowNames[0]]: data[intoKey].elements[i]['--rowNumber'], [rowNames[1]]: [] }
        if (r && is[r] && is[r].length > 0) {
          data[intoKey].elements[i].submittingOrganisation = { defraCustomerOrganisationId }
          updateIn(
            data[intoKey].elements[i],
            target,
            is[r].map((x) => {
              rowNumbers[r][rowNames[1]].push(x['--rowNumber'])
              delete x['--rowNumber']
              deleteLeaf(x, joinKey)
              return x
            })
          )
        }
        // WARNING: mutabliy updates movements array from supplied transform
        collectCellErrors(
          errors[intoKey], // TODO this isn't right??
          () => (data[intoKey].elements[i] = transform(data[intoKey].elements[i])),
          null,
          [null, data[intoKey].elements[i]['--rowNumber']],
          {}
        ) // nosonar
        delete data[intoKey].elements[i]['--rowNumber']
        if (r) {
          delete is[r]
        }
      }
      if (data[intoKey].elements.length === 0) {
        errors[intoKey].push(cellError(movementRefCol, errorWorksheet.firstRowOfData, 'No movements recognised', errorWorksheet.worksheetName))
      }
      if (Object.keys(is).length > 0) {
        for (const i of Object.values(is).flatMap((x) => x)) {
          if (getIn(i, joinKey)) {
            errors.items.push(cellError(itemRefCol, i['--rowNumber'], 'No waste movements for unique reference'))
          }
        }
      }
      console.log(`>>>>>> ${intoKey} # ${Object.keys(data)}`)
      return { ...data, [intoKey]: data[intoKey].elements, errors, rowNumbers }
    }, flatData)
  } else {
    console.log('.... TODO no joins not currently implemented')
    return flatData
    // return Object.keys(flatData).reduce((data, key) => {
    //   if (errors[key] == null) {
    //     errors[key] = []
    //   }
    //   return data
    // }, flatData)
  }
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

export const getWorksheetMeta = (() => {
  // TODO move 'yourUniqueReference' into here?
  const knownTemplateVersions = {
    'Report receipt of waste': {
      worksheets: {
        '7. Waste movement level': {
          target: 'movements',
          firstRowOfData: 9,
          worksheetName: '7. Waste movement level',
          mapping: [
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
          ],
          keyCols: [3, 4, 5, 6, 7] // nosonar
        },
        '8. Waste item level': {
          target: 'items',
          firstRowOfData: 9,
          worksheetName: '8. Waste item level',
          mapping: [
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
          ],
          keyCols: [2, 3, 4, 5, 6, 7, 8, 9] // nosonar
        }
      },
      joins: [{ joinKey: ['yourUniqueReference'], keys: ['movements', 'items'], target: ['wasteItems'], rowNames: ['movementRow', 'itemRows'] }],
      transform: (validateFn) =>
        compose(
          validateFn,
          coerceRegistrationNumberWhenReasonSupplied,
          validateMovementHasWasteItems,
          populateWholeItemDisposalCodes,
          validateUniqueReference()
        ),
      errors: { '7. Waste movement level': 1, '8. Waste item level': 1 },
      defaultErrorWorksheet: '7. Waste movement level',
      copyFromResult: [{ source: ['wasteTrackingId'], target: { worksheetName: '7. Waste movement level', col: 2 } }],
      version: '1'
    },
    'Report receipt of waste v1.2': {}
  }

  const constructErrorMatchers = (md) => {
    const worksheetsByTarget = (m) => Object.groupBy(Object.values(m.worksheets), ({ target }) => target)
    return md.joins.reduce(
      (m, join) => {
        const ws = worksheetsByTarget(m)
        const leftWs = ws[join.keys[1]]
        m.errorTargets.push({ target: join.target, worksheetName: leftWs[0]?.worksheetName, joinKey: join.joinKey })
        const rightWs = ws[join.keys[0]]
        m.errorTargets.push({ target: [], worksheetName: rightWs[0]?.worksheetName, joinKey: join.joinKey })
        return m
      },
      { ...md, errorTargets: [] }
    )
  }

  const constructUpdateFns = (md) =>
    Object.keys(md.worksheets).reduce((m, k) => {
      m.worksheets[k].updateFn = updateData(m.worksheets[k].mapping)
      m.worksheets[k].maxCol = m.worksheets[k].mapping.length
      if (m.worksheets[k].keyCols == null) {
        m.worksheets[k].keyCols = m.worksheets[k].mapping.map((c, i) => (c.length > 0 ? i : null)).filter((x) => x)
      }
      return m
    }, md)

  return (workbook, validateFn, logger) => {
    const templateKey = cellValueText(workbook.getWorksheet(workbook.worksheets[0].name).getRow(1).getCell(1).value)
    const metadata = knownTemplateVersions[templateKey]
    if (metadata == null) {
      logger.error(
        `Unknown template key - '${templateKey}' taken from worksheet named '${workbook.worksheets[0].name}'` +
          ` with worksheets: ${workbook.worksheets.map((ws) => ws.name).join(', ')}`
      )
      return null
    }
    if (Object.keys(metadata.worksheets).some((w) => workbook.getWorksheet(w) == null)) {
      logger.error(`Excel Workbook lacks the correct worksheets: ${workbook.worksheets.map((ws) => ws.name).join(', ')}`)
      return null
    } else {
      logger.info(
        `Selecting template version ${metadata.version} from template key ${templateKey}` +
          ` with worksheets: ${workbook.worksheets.map((ws) => ws.name).join(', ')}`
      )
    }
    return {
      ...constructUpdateFns(constructErrorMatchers(metadata)),
      transform: metadata.transform(validateFn)
    }
  }
})()

export const parseExcelFile = (() => {
  return async (buffer, defraCustomerOrganisationId, logger, validateFn) => {
    const workbook = await readExcelBuffer(buffer)
    if (workbook == null) {
      return { hasErrors: true }
    }
    const worksheetMetadata = getWorksheetMeta(workbook, validateFn, logger)
    console.log('worksheetMetadata: ', JSON.stringify(worksheetMetadata, null, 4))
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
    // console.log('flatData: ', JSON.stringify(flatData, null, 4))
    const joined = joinWasteItems(flatData, worksheetMetadata, defraCustomerOrganisationId)
    // logger.trace(`joined excel data: ${JSON.stringify(joined, null, 4)}`)
    console.log(
      '>>',
      flatData.movements.errors.length > 0,
      flatData.items.errors.length > 0,
      joined.errors.items.length > 0,
      joined.errors.movements.length > 0
    )
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
      console.log('colNum less than jake {ref, msg, colNum}: ', JSON.stringify({ ref, msg, colNum, errKeyPath }, null, 4))
      return {}
    }
    const errorValue = movementMapping[colNum][0].reduce((x, y) => x[y], movementData[idx])
    console.log('{ref, msg, colNum, errorValue}: ', JSON.stringify({ ref, msg, colNum, errorValue }, null, 4))
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

  const movementRefCol = 3

  return (movementData, rowNumbers, { defaultErrorWorksheet, worksheets, errorTargets }, error) => {
    const errKeyPath = error.key.split('.')
    console.log(
      'error: ',
      JSON.stringify(error, null, 4),
      'errorKeyPath > ',
      JSON.stringify(errKeyPath, null, 4),
      'errorTargets >> ',
      JSON.stringify(errorTargets, null, 4)
    )
    if (errKeyPath[0].match(/^[0-9]+$/)) {
      const joinErrorTarget = errorTargets.reduce((err, errTarget) => {
        if (err?.coords) {
          return err
        }
        if (errKeyPath[1] === errTarget.target[0] && errKeyPath[2].match(/^[0-9]+$/)) {
          console.log(`errorToCoords item >>>> ${JSON.stringify(errTarget)}`)
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
          // console.log(`errorToCoords movement >>>> ${JSON.stringify(errTarget)}`)
          console.log(
            'errorToCoords movement >>',
            JSON.stringify({ movementData, first_errKeyPath: errKeyPath[0], rowNumbers, errKeyPath, error, errTarget, defaultErrorWorksheet }, null, 4)
          )
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
            console.log(JSON.stringify({ e }))
            return e
          }
        }
        return err
      }, {})
      if (joinErrorTarget?.coords) {
        return joinErrorTarget
      }
    }
    return cellError(movementRefCol, worksheets[defaultErrorWorksheet].firstRowOfData, error.message, defaultErrorWorksheet)
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
      ...apiResultData.map((obj, idx) => {
        const wasteTrackingId = getIn(obj, source)
        const { movementRow } = rowNumbers[movementData[idx]['yourUniqueReference']] // TODO take join key as arg
        return {
          coords: [target.col, movementRow],
          value: wasteTrackingId,
          sheet: target.worksheetName
        }
      })
    )
    return result
  }, {})

// alias these function so I don't have to refactor everthing at once
export const updateErrors = (worksheet, coords, worksheetMetadata) => {
  return xlUpdateErrors(worksheet, coords, worksheetMetadata)
}
export const updateCellContent = (workbook, cellsAndValues) => {
  return xlUpdateCellContent(workbook, cellsAndValues)
}
export const workbookToByteArray = (workbook) => {
  return xlWorkbookToByteArray(workbook)
}

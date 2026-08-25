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
} from './parsers.js'
import {
  compose,
  coerceRegistrationNumberWhenReasonSupplied,
  validateMovementHasWasteItems,
  validateUniqueReference,
  populateWholeItemDisposalCodes,
  validateWasteTrackingIdExists,
  validateWasteTrackingIdMissing
} from './transforms.js'
import { cellValueText } from './excel.js'
import { updateIn } from './utils.js'

const updateData = (cols) => {
  return (r, [colNum, _rowNum], value) => {
    const [cs, func] = cols[colNum]
    updateIn(r, cs, value, func)
    return r
  }
}

export const getWorksheetMeta = (() => {
  /* v8 ignore start */
  const knownTemplateVersions = {
    'Report receipt of waste': {
      worksheets: {
        '7. Waste movement level': {
          target: 'movements',
          firstRowOfData: 9,
          defaultErrorCol: 3,
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
          defaultErrorCol: 2,
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
      joins: ({ defraCustomerOrganisationId }) => [
        {
          joinKey: ['yourUniqueReference'],
          keys: ['movements', 'items'],
          target: ['wasteItems'],
          rowNames: ['movementRow', 'itemRows'],
          process: (x) => {
            x.submittingOrganisation = { defraCustomerOrganisationId }
            return x
          }
        }
      ],
      transform: (validateFn) =>
        compose(
          typeof validateFn === 'function' ? validateFn : validateFn === 'update' ? validateWasteTrackingIdExists(2) : validateWasteTrackingIdMissing(2),
          coerceRegistrationNumberWhenReasonSupplied,
          validateMovementHasWasteItems(3),
          populateWholeItemDisposalCodes,
          validateUniqueReference(3)
        ),
      errors: { '7. Waste movement level': 1, '8. Waste item level': 1 },
      defaultErrorWorksheet: '7. Waste movement level',
      copyFromResult: [{ source: ['wasteTrackingId'], target: { worksheetName: '7. Waste movement level', col: 2 } }],
      version: '1'
    },
    'Report receipt of waste v1.2': {
      worksheets: {
        '2. Waste movement details': {
          target: 'movements',
          firstRowOfData: 3,
          defaultErrorCol: 3,
          worksheetName: '2. Waste movement details',
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
        '3. Waste item details': {
          target: 'items',
          firstRowOfData: 3,
          defaultErrorCol: 2,
          worksheetName: '3. Waste item details',
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
      joins: ({ defraCustomerOrganisationId }) => [
        {
          joinKey: ['yourUniqueReference'],
          keys: ['movements', 'items'],
          target: ['wasteItems'],
          rowNames: ['movementRow', 'itemRows'],
          process: (x) => {
            x.submittingOrganisation = { defraCustomerOrganisationId }
            return x
          }
        }
      ],
      transform: (validateFn) =>
        compose(
          typeof validateFn === 'function' ? validateFn : validateFn === 'update' ? validateWasteTrackingIdExists(2) : validateWasteTrackingIdMissing(2),
          coerceRegistrationNumberWhenReasonSupplied,
          validateMovementHasWasteItems(3),
          populateWholeItemDisposalCodes,
          validateUniqueReference(3)
        ),
      errors: { '2. Waste movement details': 1, '3. Waste item details': 1 },
      defaultErrorWorksheet: '2. Waste movement details',
      copyFromResult: [{ source: ['wasteTrackingId'], target: { worksheetName: '2. Waste movement details', col: 2 } }],
      version: '1'
    }
  }
  /* v8 ignore stop */

  const constructErrorMatchers = (md) => {
    const worksheetsByTarget = Object.groupBy(Object.values(md.worksheets), ({ target }) => target)
    return md.joins.reduce(
      (m, join) => {
        const leftWs = worksheetsByTarget[join.keys[1]]
        m.errorTargets.push({ target: join.target, worksheetName: leftWs[0]?.worksheetName, joinKey: join.joinKey })
        const rightWs = worksheetsByTarget[join.keys[0]]
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

  const constructJoins = (md, defaultData) => {
    const worksheetsByTarget = Object.groupBy(Object.values(md.worksheets), ({ target }) => target)
    const arrayEqual = (x, y) => x && y && x.length === y.length && x.every((v, i) => v === y[i])
    const joins = (typeof md?.joins === 'function' ? md.joins(defaultData) : md.joins).map((join) => {
      return {
        ...join,
        refCols: join.keys.map((k) => {
          return worksheetsByTarget[k][0].mapping.findIndex(([col]) => {
            return arrayEqual(col, join.joinKey)
          })
        })
      }
    })
    return { ...md, joins }
  }

  return (workbook, validateFn, defraCustomerOrganisationId, logger) => {
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
    const m = constructUpdateFns(constructErrorMatchers(constructJoins(metadata, { defraCustomerOrganisationId })))
    return { ...m, transform: metadata.transform(validateFn) }
  }
})()

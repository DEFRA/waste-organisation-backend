import { customValidationExports, headerRows } from './catalogue.js'
import { describedRegex, parserSentences, regexesInSource, validationPatternLines } from './patterns.js'

const columnLetters = (number) => {
  let letters = ''
  let remaining = number
  while (remaining > 0) {
    const index = (remaining - 1) % 26
    letters = String.fromCodePoint(65 + index) + letters
    remaining = Math.floor((remaining - 1) / 26)
  }
  return letters
}

const allowValues = (node) => (node?.allow ?? []).filter((value) => !(value && typeof value === 'object' && value.override === true))

const formatLiteral = (value) => {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (value instanceof RegExp) {
    return value.toString()
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatLiteral(item)).join(', ')
  }
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([key, item]) => `${key} -> ${formatLiteral(item)}`)
      .join(', ')
  }
  if (value === null) {
    return 'null'
  }
  return String(value)
}

const formatIs = (is) => {
  const values = allowValues(is)
  if (values.length > 0) {
    return values.map(formatLiteral).join(' or ')
  }
  if (is?.flags?.presence === 'required') {
    return 'present'
  }
  return is?.type ?? ''
}

const presenceWord = (node) => node?.flags?.presence ?? 'optional'

const formatWhen = (when) => {
  const ref = when.ref?.path?.join('.') ?? ''
  const lines = []
  let otherwise = null
  for (const branch of when.switch ?? [when]) {
    if (branch.is || branch.then) {
      lines.push(`when ${ref} is ${formatIs(branch.is)} then ${presenceWord(branch.then)}`)
    }
    if (branch.otherwise) {
      otherwise = branch.otherwise
    }
  }
  if (otherwise) {
    lines.push(`otherwise ${presenceWord(otherwise)}`)
  }
  return lines
}

const presenceOf = (node) => {
  if (!node) {
    return { kind: 'none' }
  }
  const whens = (node.whens ?? []).flatMap(formatWhen)
  if (whens.length > 0) {
    return { kind: 'conditional', whens }
  }
  return { kind: node.flags?.presence ?? 'optional' }
}

const hasCustom = (node) => {
  if (!node) {
    return false
  }
  if ((node.rules ?? []).some((rule) => rule.name === 'custom')) {
    return true
  }
  return Object.values(node.keys ?? {}).some(hasCustom) || (node.items ?? []).some(hasCustom) || (node.matches ?? []).some((match) => hasCustom(match.schema))
}

const customErrorMessages = (constants) => {
  if (!constants) {
    return []
  }
  const messages = []
  for (const value of Object.values(constants.errors ?? {})) {
    if (typeof value === 'string') {
      messages.push(value)
    } else if (value && typeof value === 'object') {
      for (const message of Object.values(value)) {
        if (typeof message === 'string') {
          messages.push(message)
        }
      }
    }
  }
  return messages
}

const stepSchema = (node, key) => {
  if (!node) {
    return null
  }
  if (node.keys && Object.hasOwn(node.keys, key)) {
    return node.keys[key]
  }
  for (const item of node.items ?? []) {
    const found = stepSchema(item, key)
    if (found) {
      return found
    }
  }
  return null
}

const samePath = (left, right) => left.length === right.length && left.every((part, index) => part === right[index])

const exampleSentences = (description) =>
  description
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.includes('For example'))

const textAt = (cellText, sheetName, row, column) => {
  const value = cellText(sheetName, row, column)
  return value == null ? '' : String(value)
}

const applies = (rule, worksheet, entry, index) => {
  if (rule.columnIndex != null) {
    return worksheet.target === rule.sheetTarget && rule.columnIndex === index
  }
  return rule.sheetTarget === worksheet.target && samePath(rule.path, entry?.path ?? [])
}

const nodesAlong = (described, parts) => {
  const found = []
  let node = described
  for (const part of parts) {
    node = stepSchema(node, part)
    if (!node) {
      return []
    }
    found.push(node)
  }
  return found
}

export const messageCatalogFrom = (utils) => {
  const catalog = {}
  for (const [name, value] of Object.entries(utils ?? {})) {
    if (!name.endsWith('ERRORS') || !value || typeof value !== 'object' || Array.isArray(value)) {
      continue
    }
    const strings = Object.entries(value).filter(([, item]) => typeof item === 'string')
    if (strings.length > 0) {
      catalog[name] = Object.fromEntries(strings)
    }
  }
  return catalog
}

export const joinSpreadsheetFields = ({ catalogueEntry, cellText, createDescribed, updateDescribed, parsers, customConstants = {}, messageCatalog = {}, patternSamples = [], customAllowedValues = {} }) => {
  const fields = []
  for (const [sheetName, worksheet] of Object.entries(catalogueEntry.worksheets)) {
    worksheet.mapping.forEach((entry, index) => {
      if (index === 0) {
        return
      }
      const empty = entry == null
      if (empty && index !== 1) {
        return
      }
      const path = entry?.path ?? []
      const apiParts = entry == null ? [] : worksheet.target === 'items' ? ['wasteItems', ...path] : [...path]
      const apiPath = apiParts.join('.')
      const createChain = path.length === 0 ? [] : nodesAlong(createDescribed, apiParts)
      const updateChain = path.length === 0 ? [] : nodesAlong(updateDescribed, apiParts)
      const chain = createChain.length > 0 ? createChain : updateChain
      const createNode = createChain.at(-1) ?? null
      const updateNode = updateChain.at(-1) ?? null
      const description = textAt(cellText, sheetName, headerRows.description, index)
      const parser = parsers[entry?.parserName] ?? null
      const examples = [...new Set(exampleSentences(description))]
      fields.push({
        sheetName,
        columnLetter: columnLetters(index),
        columnName: textAt(cellText, sheetName, headerRows.columnName, index),
        obligation: textAt(cellText, sheetName, headerRows.obligation, index),
        description,
        apiPath,
        errorColumn: index === 1 && empty,
        presence: { create: presenceOf(createNode), update: presenceOf(updateNode) },
        parser,
        rules: (catalogueEntry.transformRules ?? []).filter((rule) => applies(rule, worksheet, entry, index)),
        schema: { create: createNode, update: updateNode },
        ancestors: chain.slice(0, -1),
        ancestorPaths: chain.length > 0 ? apiParts.slice(0, -1) : [],
        rootMessages: createDescribed?.preferences?.messages ?? {},
        messageCatalog,
        validationRegexes: Object.values(customConstants[apiPath]?.regexes ?? {})
          .flat()
          .filter((value) => value instanceof RegExp),
        patternSamples: [...patternSamples, ...(customConstants[apiPath]?.samples ?? [])],
        customConstants: hasCustom(createNode) || hasCustom(updateNode) ? customErrorMessages(customConstants[apiPath]) : [],
        customAllowedValues,
        examples
      })
    })
  }
  return fields
}

const formatList = (values) => values.map((item) => (typeof item === 'string' ? JSON.stringify(item) : String(item))).join(', ')

const listSentence = (name, values, columnName) => {
  const sentences = {
    estVals: `${columnName} is treated as an estimate when it is ${values}.`,
    actVals: `${columnName} is treated as an actual amount when it is ${values}.`,
    trueVals: `${columnName} is treated as yes when it is ${values}.`,
    falseVals: `${columnName} is treated as no when it is ${values}.`
  }
  return sentences[name]
}

const knownCheck = (message, columnName, itemSheetName) => {
  const checks = {
    'Please provide a value': `${columnName} cannot be left blank.`,
    'Waste Tracking ID is required': `When updating a movement, ${columnName} must be filled in.`,
    'Waste Tracking ID must not be present on a create upload': `When uploading a new movement, leave ${columnName} blank.`,
    'No waste items for unique reference': `There is no row on ${itemSheetName} with this same ${columnName}.`,
    'Duplicate reference': `This ${columnName} is already used on another row of this sheet.`
  }
  return checks[message] ?? null
}

const check = (text) => ({ kind: 'check', text })
const error = (text) => ({ kind: 'error', text })
const condition = (text) => ({ kind: 'condition', text })

const columnNameFor = (fields, sheetName, pathEnd) => fields.find((field) => field.sheetName === sheetName && field.apiPath.split('.').at(-1) === pathEnd)?.columnName

const conditionSentences = (presence, field, fields) => {
  const lines = []
  for (const line of presence?.whens ?? []) {
    const match = line.match(/^when (\S+) is (.+) then (\w+)$/)
    if (!match) {
      continue
    }
    const otherColumn = columnNameFor(fields, field.sheetName, match[1])
    const raw = match[2]
    const value = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw
    const outcome = match[3]
    if (!otherColumn) {
      if (value === 'present' && outcome === 'required') {
        lines.push(check('A number is required when an operator is entered before it.'))
      }
      continue
    }
    if (value === 'null' || value === '') {
      if (outcome === 'required') {
        lines.push(condition(`Fill in ${field.columnName} when ${otherColumn} is left blank.`))
      }
      if (outcome === 'forbidden') {
        lines.push(condition(`Leave ${field.columnName} blank when ${otherColumn} is left blank.`))
      }
      continue
    }
    if (value === 'true' && outcome === 'required') {
      lines.push(condition(`Fill in ${field.columnName} when ${otherColumn} is yes.`))
      continue
    }
    if (value === 'false' && outcome === 'required') {
      lines.push(condition(`Fill in ${field.columnName} when ${otherColumn} is no.`))
      continue
    }
    if (value === 'present' && outcome === 'required') {
      lines.push(condition(`Fill in ${field.columnName} when ${otherColumn} is filled in.`))
      continue
    }
    if (outcome === 'required') {
      lines.push(condition(`Fill in ${field.columnName} when ${otherColumn} is ${value}.`))
    }
    if (outcome === 'forbidden') {
      lines.push(condition(`Leave ${field.columnName} blank when ${otherColumn} is ${value}.`))
    }
  }
  if ((presence?.whens ?? []).some((when) => when.startsWith('otherwise forbidden'))) {
    lines.push(condition(`Otherwise leave ${field.columnName} blank.`))
  }
  return lines
}

const acceptedValues = (node) => allowValues(node).filter((value) => typeof value === 'string' && value.trim() !== '' && value.length < 80)

const blankAllowed = (node) => (node?.allow ?? []).some((value) => value === '' || value === null)

const mentions = (key, segment) => {
  const haystack = key.toLowerCase()
  const needle = segment.toLowerCase()
  const index = haystack.indexOf(needle)
  if (index < 0) {
    return false
  }
  const before = haystack[index - 1]
  return !before || !/[a-z0-9]/i.test(before)
}

const columnNameForKey = (fields, sheetName, apiPath, key) => {
  const parent = apiPath.split('.').slice(0, -1).join('.')
  const sibling = fields.find((field) => field.sheetName === sheetName && field.apiPath === `${parent}.${key}`)
  if (sibling) {
    return sibling.columnName
  }
  return fields.find((field) => field.sheetName === sheetName && field.apiPath.split('.').at(-1) === key)?.columnName ?? fields.find((field) => field.apiPath.split('.').at(-1) === key)?.columnName ?? null
}

const readable = (text, columnName, fields, sheetName, apiPath) => {
  if (!text || text === '{{#message}}') {
    return null
  }
  let sentence = text.replaceAll('{{#label}}', columnName).replaceAll('{{ #label }}', columnName)
  sentence = sentence.replaceAll(/\b[A-Za-z][A-Za-z0-9]*(?:\[\*\]|\.[A-Za-z][A-Za-z0-9]*)+/g, (path) => {
    if (!/[A-Z]/.test(path)) {
      return path
    }
    const end = path
      .split(/\.|\[\*\]/)
      .filter(Boolean)
      .at(-1)
    return columnNameForKey(fields, sheetName, apiPath, end) ?? ''
  })
  const keys = [...new Set(fields.filter((field) => field.sheetName === sheetName).map((field) => field.apiPath.split('.').at(-1)))].filter((key) => key && /[A-Z]/.test(key)).sort((left, right) => right.length - left.length)
  for (const key of keys) {
    const name = columnNameForKey(fields, sheetName, apiPath, key)
    if (name) {
      sentence = sentence.replaceAll(`"${key}"`, name)
      sentence = sentence.replaceAll(new RegExp(`\\b${key}\\b`, 'g'), name)
    }
  }
  sentence = sentence
    .replaceAll(/\s{2,}/g, ' ')
    .replaceAll(/\s+([.,])/g, '$1')
    .trim()
  sentence = sentence.replaceAll(' is true', ' is yes').replaceAll(' is false', ' is no')
  if (!sentence || sentence.includes('{{') || sentence.includes('[*]') || sentence.includes('\\d') || sentence.startsWith('/')) {
    return null
  }
  return sentence
}

const messageTemplate = (message) => {
  if (typeof message === 'string') {
    return message
  }
  if (typeof message?.template === 'string') {
    return message.template
  }
  return null
}

const catalogMessage = (field, key) => {
  const catalog = field.messageCatalog ?? {}
  const pops = field.apiPath.includes('.pops.')
  const messages = {
    'BusinessRuleViolation.componentsNotAllowed': catalog.POPS_OR_HAZARDOUS_ERRORS?.COMPONENTS_NOT_ALLOWED_NOT_PROVIDED,
    'BusinessRuleViolation.componentsNotAllowedWhenFalse': pops ? catalog.POPS_ERRORS?.COMPONENTS_NOT_ALLOWED_FALSE : catalog.HAZARDOUS_ERRORS?.COMPONENTS_NOT_ALLOWED_FALSE,
    'BusinessRuleViolation.sourceOfComponentsRequired': pops ? catalog.POPS_ERRORS?.REQUIRED_WHEN_CONTAINS_POPS_TRUE : catalog.HAZARDOUS_ERRORS?.REQUIRED_WHEN_CONTAINS_HAZARDOUS_TRUE,
    'BusinessRuleViolation.componentsRequired': pops ? catalog.POPS_ERRORS?.REQUIRED_WHEN_CONTAINS_POPS_TRUE : catalog.HAZARDOUS_ERRORS?.REQUIRED_WHEN_CONTAINS_HAZARDOUS_TRUE,
    'BusinessRuleViolation.hazCodesRequired': catalog.HAZARDOUS_ERRORS?.HAZ_CODES_REQUIRED
  }
  return messages[key] ?? null
}

const coveredByStructure = new Set(['BusinessRuleViolation.sourceOfComponentsRequired', 'BusinessRuleViolation.hazCodesRequired', 'BusinessRuleViolation.componentsRequired'])

const schemaNodes = (field, fields) => {
  const claimed = new Set(fields.map((item) => item.apiPath))
  const nodes = []
  const walk = (node, path) => {
    if (!node) {
      return
    }
    nodes.push({ node, path })
    for (const [key, child] of Object.entries(node.keys ?? {})) {
      const childPath = `${path}.${key}`
      if (!claimed.has(childPath)) {
        walk(child, childPath)
      }
    }
    for (const child of node.items ?? []) {
      walk(child, `${path}.*`)
    }
    for (const match of node.matches ?? []) {
      walk(match.schema, path)
    }
  }
  for (const node of [field.schema?.create, field.schema?.update]) {
    if (node) {
      walk(node, field.apiPath)
    }
  }
  return nodes
}

const numberSentence = (path, field, sentence) => {
  if (path === field.apiPath) {
    return sentence
  }
  if (path === `${field.apiPath}.*`) {
    return sentence.replace(/^Must /, 'Each value must ')
  }
  return `Each number in this cell ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`
}

const schemaSentences = (field, fields) => {
  const lines = []
  const own = field.schema?.create
  const requiredThroughout = (field.ancestors ?? []).every((ancestor) => ancestor.type === 'array' || ancestor.flags?.presence === 'required')
  if (own?.flags?.presence === 'required' && !blankAllowed(own) && requiredThroughout) {
    lines.push(check(own.type === 'array' ? 'At least one value is required.' : `${field.columnName} cannot be left blank.`))
  } else if (own?.flags?.presence === 'required' && !blankAllowed(own)) {
    const optionalIndex = [...(field.ancestors ?? [])].reverse().findIndex((ancestor) => ancestor.type !== 'array' && ancestor.flags?.presence !== 'required')
    const optionalPath = optionalIndex >= 0 ? field.ancestorPaths?.[field.ancestors.length - 1 - optionalIndex] : null
    const group = optionalPath
      ?.split('.')
      .at(-1)
      ?.replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
    if (group) {
      lines.push(check(`When ${group} details are included, ${field.columnName} cannot be left blank.`))
    }
  }
  const segment = field.apiPath.split('.').at(-1)
  for (const template of Object.values(field.rootMessages ?? {})) {
    const text = messageTemplate(template)
    if (text?.includes(`"${segment}"`)) {
      const sentence = readable(text, field.columnName, fields, field.sheetName, field.apiPath)
      if (sentence) {
        lines.push(error(sentence))
      }
    }
  }
  for (const ancestor of field.ancestors ?? []) {
    const keys = Object.keys(ancestor.preferences?.messages ?? {})
    if (!keys.some((key) => mentions(key, segment))) {
      continue
    }
    if (keys.some((key) => key.includes('componentsRequired') && mentions(key, segment) && segment === 'components')) {
      const parent = field.apiPath.split('.').slice(0, -1).join('.')
      const source = fields.find((item) => item.sheetName === field.sheetName && item.apiPath === `${parent}.sourceOfComponents`)
      const triggers = [...new Set([...(source ? acceptedValues(source.schema?.create) : []), ...(source ? acceptedValues(source.schema?.update) : [])])].filter((value) => value === 'GUIDANCE' || value === 'OWN_TESTING')
      if (source && triggers.length > 0) {
        lines.push(condition(`Fill in ${field.columnName} when ${source.columnName} is ${triggers.join(' or ')}.`))
        continue
      }
    }
    lines.push(...conditionSentences(presenceOf(ancestor), field, fields))
  }
  for (const { node, path } of schemaNodes(field, fields)) {
    const values = acceptedValues(node)
    if (values.length > 0 && (node.flags?.only || node.type === 'string')) {
      if (values.every((value) => value === '<' || value === '>')) {
        lines.push(check(`A concentration can start with ${values.join(' or ')}.`))
      } else {
        lines.push(check(`The upload accepts: ${values.join(', ')}.`))
      }
    }
    const customValues = (node.rules ?? []).some((rule) => rule.name === 'custom')
      ? field.customAllowedValues?.[
          path
            .split('.')
            .filter((part) => part !== '*')
            .at(-1)
        ]
      : null
    if (customValues?.length) {
      lines.push(check(`The upload accepts: ${customValues.join(', ')}.`))
    }
    const stated = new Set()
    for (const rule of node.rules ?? []) {
      const template = messageTemplate(rule.message)
      if (template) {
        stated.add(template)
      }
      if (rule.name === 'email') {
        lines.push(check(`${field.columnName} must be an email address.`))
      }
      if (rule.name === 'integer') {
        lines.push(check(numberSentence(path, field, 'Must be a whole number.')))
      }
      if (rule.name === 'sign' && rule.args?.sign === 'positive') {
        lines.push(check(numberSentence(path, field, 'Must be greater than zero.')))
      }
      if (rule.name === 'min' && node.type === 'number' && rule.args?.limit != null) {
        lines.push(check(numberSentence(path, field, rule.args.limit === 0 ? 'Must be zero or greater.' : `Must be at least ${rule.args.limit}.`)))
      }
      if (rule.name === 'max' && rule.args?.limit != null && !node.preferences?.messages?.[`${node.type}.max`]) {
        if (node.type === 'array') {
          lines.push(check(`No more than ${rule.args.limit} values.`))
        } else if (node.type === 'number') {
          lines.push(check(numberSentence(path, field, `Must be no more than ${rule.args.limit}.`)))
        } else if (node.type === 'string' || node.type == null) {
          lines.push(check(`No more than ${rule.args.limit} characters.`))
        }
      }
    }
    const templates = [...Object.entries(node.preferences?.messages ?? {}).map(([key, value]) => [key, messageTemplate(value)]), ...[...stated].map((value) => [null, value])]
    for (const [key, template] of templates) {
      const text = template === '{{#message}}' ? catalogMessage(field, key) : template
      if (!text || (key && coveredByStructure.has(key))) {
        continue
      }
      const sentence = readable(text, field.columnName, fields, field.sheetName, field.apiPath)
      if (sentence) {
        lines.push(error(sentence))
      }
    }
  }
  return lines
}

const schemaPatternRegexes = (field, fields) => {
  const found = []
  for (const { node } of schemaNodes(field, fields)) {
    for (const rule of node.rules ?? []) {
      if (rule.name === 'pattern' && rule.args?.regex != null) {
        const regex = describedRegex(rule.args.regex)
        if (regex) {
          found.push(regex)
        }
      }
    }
  }
  return found
}

const readableMessages = (constants, columnName, fields, sheetName, apiPath) => {
  const lines = []
  for (const text of constants) {
    const sentence = readable(text, columnName, fields, sheetName, apiPath)
    if (sentence) {
      lines.push(error(sentence))
    }
  }
  return lines
}

const messageRecord = (message, columnName, itemSheetName) => {
  const rewritten = knownCheck(message, columnName, itemSheetName)
  return rewritten ? check(rewritten) : error(`If this cell cannot be read: ${message}`)
}

export const adviceFor = (field, fields, itemSheetName) => {
  if (field.errorColumn) {
    return [check('This column is filled in after the upload. It lists any problems that were found. Do not type in it.')]
  }
  const lines = []
  for (const name of ['estVals', 'actVals', 'trueVals', 'falseVals']) {
    const values = field.parser?.lists?.[name]
    if (values) {
      lines.push(check(listSentence(name, formatList(values), field.columnName)))
    }
  }
  lines.push(...parserSentences(field.parser, field.columnName))
  for (const message of field.parser?.messages ?? []) {
    lines.push(messageRecord(message, field.columnName, itemSheetName))
  }
  for (const rule of field.rules ?? []) {
    if (rule.name === 'populateWholeItemDisposalCodes') {
      lines.push(check('If this cell has one disposal or recovery code and its weight is written as whole item, the weight from the weight column on that row is used.'))
      continue
    }
    if (rule.name === 'coerceRegistrationNumberWhenReasonSupplied') {
      lines.push(check(`If a reason for having no registration number is filled in and ${field.columnName} is empty, it is treated as blank.`))
      continue
    }
    for (const message of rule.messages ?? []) {
      const rewritten = knownCheck(message, field.columnName, itemSheetName)
      lines.push(rewritten ? check(rewritten) : error(message))
    }
  }
  const presence = field.presence?.create?.whens?.length ? field.presence.create : field.presence?.update
  lines.push(...conditionSentences(presence, field, fields))
  lines.push(...schemaSentences(field, fields))
  lines.push(...readableMessages(field.customConstants ?? [], field.columnName, fields, field.sheetName, field.apiPath))
  lines.push(...validationPatternLines([...(field.validationRegexes ?? []), ...schemaPatternRegexes(field, fields)], field.patternSamples ?? []).map((text) => check(text)))
  const seen = new Set()
  return lines.filter((record) => {
    const key = `${record.kind}:${record.text}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export const customConstantsFrom = (utils, sources = {}) => {
  const constants = {}
  for (const [apiPath, spec] of Object.entries(customValidationExports)) {
    const take = (names) =>
      Object.fromEntries(
        (names ?? []).map((name) => {
          if (utils[name] == null) {
            throw new Error(`@defra/waste-movement-utils does not export ${name}`)
          }
          return [name, utils[name]]
        })
      )
    const regexes = take(spec.regexes)
    const samples = []
    for (const file of spec.regexFiles ?? []) {
      if (sources[file] == null) {
        throw new Error(`Missing source for ${file}`)
      }
      const found = regexesInSource(sources[file])
      regexes[file] = found.regexes
      samples.push(...found.samples)
    }
    constants[apiPath] = { regexes, errors: take(spec.errors), samples }
  }
  return constants
}

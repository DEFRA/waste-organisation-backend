import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import * as acorn from 'acorn'
import { base, full, recursive } from 'acorn-walk'

export const workbookRelativePath = '../waste-organisation-frontend/src/server/spreadsheet/downloadSpreadsheet/templates/receipt-of-waste-template.xlsx'

export const outputRelativePath = 'docs/spreadsheet-validation-rules.md'

// The downloadable workbook keeps these on separate rows. They are not in the service source.
export const headerRows = { obligation: 5, columnName: 6, description: 7 }

// Custom Joi nodes do not describe their regexes. These are the exported utils constants for those paths.
export const customValidationExports = {
  'receiver.authorisationNumber': {
    regexes: ['ALL_SITE_AUTHORISATION_NUMBER_REGEXES'],
    errors: ['AUTHORISATION_ERRORS']
  },
  hazardousWasteConsignmentCode: {
    errors: ['CONSIGNMENT_ERRORS'],
    // These patterns are not exported. They live as regex literals in this file.
    regexFiles: ['src/schemas/hazardous-waste-consignment.js']
  }
}

const parseSource = (source) => acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' })

export const walk = (node, visit) => {
  if (!node || typeof node.type !== 'string') {
    return
  }
  full(node, visit)
}

const isPureLiteral = (node) => {
  if (!node) {
    return false
  }
  if (node.type === 'Literal') {
    return true
  }
  if (node.type === 'ArrayExpression') {
    return node.elements.every((element) => element == null || isPureLiteral(element))
  }
  if (node.type === 'ObjectExpression') {
    return node.properties.every((property) => property.type === 'Property' && !property.computed && isPureLiteral(property.value))
  }
  return false
}

const literalValue = (node) => {
  if (node.type === 'Literal') {
    return node.value
  }
  if (node.type === 'ArrayExpression') {
    return node.elements.map((element) => (element == null ? null : literalValue(element)))
  }
  return Object.fromEntries(node.properties.map((property) => [property.key.name ?? property.key.value, literalValue(property.value)]))
}

const topLevelFunctions = (ast) => {
  const functions = new Map()
  for (const statement of ast.body) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    if (declaration?.type === 'FunctionDeclaration' && declaration.id) {
      functions.set(declaration.id.name, declaration)
    }
    if (declaration?.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations) {
        if (declarator.id.type === 'Identifier' && declarator.init) {
          functions.set(declarator.id.name, declarator.init)
        }
      }
    }
  }
  return functions
}

const functionRoot = (node) => {
  if (node?.type === 'CallExpression' && (node.callee.type === 'ArrowFunctionExpression' || node.callee.type === 'FunctionExpression')) {
    return node.callee
  }
  return node
}

const referencedFunctions = (root, functions) => {
  const included = []
  const seen = new Set()
  const add = (name) => {
    if (!functions.has(name) || seen.has(name)) {
      return
    }
    seen.add(name)
    const fn = functionRoot(functions.get(name))
    included.push(fn)
    walk(fn, (node) => {
      if (node.type === 'Identifier') {
        add(node.name)
      }
    })
  }
  walk(root, (node) => {
    if (node.type === 'Identifier') {
      add(node.name)
    }
  })
  return included
}

const stringConstant = (name, functions) => {
  const init = functions?.get(name)
  if (init?.type === 'Literal' && typeof init.value === 'string') {
    return init.value
  }
  if (init?.type === 'TemplateLiteral' && init.expressions.length === 0) {
    return init.quasis.map((part) => part.value.cooked ?? '').join('')
  }
  return null
}

const parametersOf = (node) => {
  const fn = functionRoot(node)
  if (!fn || !Array.isArray(fn.params)) {
    return []
  }
  return fn.params.flatMap((param) => (param.type === 'Identifier' ? [param.name] : []))
}

const messageFromArgument = (argument) => {
  if (argument?.type === 'Literal' && typeof argument.value === 'string') {
    return argument.value
  }
  if (argument?.type === 'TemplateLiteral') {
    return argument.quasis.map((part) => part.value.cooked ?? '').join('…')
  }
  return null
}

const thrownParameterNames = (node) => {
  const names = new Set()
  const params = new Set(parametersOf(node))
  const fn = functionRoot(node)
  if (!fn?.type) {
    return names
  }
  walk(fn, (child) => {
    if (child.type !== 'NewExpression' || child.callee.type !== 'Identifier' || child.callee.name !== 'Error') {
      return
    }
    const argument = child.arguments[0]
    if (argument?.type === 'Identifier' && params.has(argument.name)) {
      names.add(argument.name)
    }
  })
  return names
}

const errorMessages = (root, functions = new Map()) => {
  const messages = []
  const seen = new Set()
  const add = (message) => {
    if (message && !seen.has(message)) {
      seen.add(message)
      messages.push(message)
    }
  }
  const fn = functionRoot(root)
  if (!fn?.type) {
    return messages
  }
  walk(fn, (node) => {
    if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'Error') {
      const argument = node.arguments[0]
      add(messageFromArgument(argument))
      if (argument?.type === 'Identifier') {
        add(stringConstant(argument.name, functions))
      }
    }
    if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier') {
      return
    }
    const callee = functions.get(node.callee.name)
    if (!callee) {
      return
    }
    const params = parametersOf(callee)
    for (const name of thrownParameterNames(callee)) {
      const argument = node.arguments[params.indexOf(name)]
      add(messageFromArgument(argument))
      if (argument?.type === 'Identifier') {
        add(stringConstant(argument.name, functions))
      }
    }
  })
  return messages
}

export const describeParser = (node, functions) => {
  const root = functionRoot(node)
  if (!root) {
    return null
  }
  const roots = [root, ...referencedFunctions(root, functions)]
  const lists = {}
  const patterns = []
  const seenPatterns = new Set()
  for (const fn of roots) {
    walk(fn, (child) => {
      if (child.type === 'VariableDeclarator' && child.id.type === 'Identifier' && isPureLiteral(child.init)) {
        lists[child.id.name] = literalValue(child.init)
      }
      if (child.type === 'Literal' && child.value instanceof RegExp) {
        const printed = child.value.toString()
        if (!seenPatterns.has(printed)) {
          seenPatterns.add(printed)
          patterns.push(printed)
        }
      }
    })
  }
  const messages = []
  const seenMessages = new Set()
  for (const message of roots.flatMap((item) => errorMessages(item, functions))) {
    if (!seenMessages.has(message)) {
      seenMessages.add(message)
      messages.push(message)
    }
  }
  if (patterns.length === 0 && messages.length === 0 && Object.keys(lists).length === 0) {
    return null
  }
  return { patterns, messages, lists }
}

const propertyName = (node) => (node.type === 'Identifier' ? node.name : node.value)

const objectProperties = (node) => {
  const properties = new Map()
  if (node?.type !== 'ObjectExpression') {
    return properties
  }
  for (const property of node.properties) {
    if (property.type === 'Property' && !property.computed) {
      properties.set(propertyName(property.key), property.value)
    }
  }
  return properties
}

const stringKeys = (node) => {
  if (node?.type !== 'ArrayExpression') {
    return []
  }
  return node.elements.filter((element) => element?.type === 'Literal' && typeof element.value === 'string').map((element) => element.value)
}

const mappingEntry = (node) => {
  if (node?.type !== 'ArrayExpression' || node.elements.length === 0) {
    return null
  }
  const [pathNode, parserNode] = node.elements
  return {
    path: stringKeys(pathNode),
    parserName: parserNode?.type === 'Identifier' ? parserNode.name : null
  }
}

const memberProperties = (node) => {
  const names = []
  walk(node, (child) => {
    if (child.type === 'MemberExpression' && !child.computed && child.property.type === 'Identifier') {
      names.push(child.property.name)
    }
  })
  return names
}

const ruleForCall = (name, columnIndex, functions) => {
  const fn = functions.get(name)
  if (!fn) {
    return null
  }
  const root = functionRoot(fn)
  const messages = errorMessages(root, functions)
  const literals = []
  walk(root, (node) => {
    if (node.type === 'Literal' && typeof node.value === 'string') {
      literals.push(JSON.stringify(node.value))
    }
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
      literals.push(JSON.stringify(node.quasis.map((part) => part.value.cooked).join('')))
    }
  })
  const properties = memberProperties(root)
  let sheetTarget = null
  let path = []
  if (properties.includes('wasteTrackingId')) {
    sheetTarget = 'movements'
    path = ['wasteTrackingId']
  } else if (properties.includes('yourUniqueReference')) {
    sheetTarget = 'movements'
    path = ['yourUniqueReference']
  } else if (properties.includes('registrationNumber')) {
    sheetTarget = 'movements'
    path = ['carrier', 'registrationNumber']
  } else if (properties.includes('disposalOrRecoveryCodes')) {
    sheetTarget = 'items'
    path = ['disposalOrRecoveryCodes']
  }
  return { name, columnIndex, sheetTarget, path, messages, literals }
}

const callsIn = (node, functions, when = null) => {
  const calls = []
  if (!node?.type) {
    return calls
  }
  recursive(node, when, {
    ConditionalExpression(child, branchWhen, callback) {
      if (child.test.type === 'BinaryExpression' && child.test.operator === '===' && child.test.right?.value === 'update') {
        callback(child.consequent, 'update')
        callback(child.alternate, 'create')
        return
      }
      base.ConditionalExpression(child, branchWhen, callback)
    },
    CallExpression(child, branchWhen, callback) {
      if (child.callee.type === 'Identifier' && functions.has(child.callee.name)) {
        const argument = child.arguments[0]
        calls.push({
          name: child.callee.name,
          columnIndex: argument?.type === 'Literal' && typeof argument.value === 'number' ? argument.value : null,
          when: branchWhen
        })
        for (const item of child.arguments) {
          if (item) {
            callback(item, branchWhen)
          }
        }
        return
      }
      base.CallExpression(child, branchWhen, callback)
    },
    Identifier(child, branchWhen) {
      if (functions.has(child.name)) {
        calls.push({ name: child.name, columnIndex: null, when: branchWhen })
      }
    },
    VariablePattern(child, branchWhen) {
      if (child.type === 'Identifier' && functions.has(child.name)) {
        calls.push({ name: child.name, columnIndex: null, when: branchWhen })
      }
    }
  })
  return calls
}

const transformRulesFrom = (transformNode, functions) => {
  const seen = new Set()
  const rules = []
  for (const call of callsIn(transformNode, functions)) {
    const rule = ruleForCall(call.name, call.columnIndex, functions)
    if (!rule) {
      continue
    }
    const key = `${rule.name}:${rule.columnIndex}:${call.when ?? ''}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    rules.push({ ...rule, when: call.when ?? null })
  }
  return rules
}

export const readOrganisationRules = (metadataSource, parsersSource, transformsSource) => {
  const metadata = parseSource(metadataSource)
  const parsers = parseSource(parsersSource)
  const transforms = parseSource(transformsSource)
  const parserFunctions = topLevelFunctions(parsers)
  const transformFunctions = topLevelFunctions(transforms)
  let catalogueNode = null
  walk(metadata, (node) => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.id.name === 'knownTemplateVersions') {
      catalogueNode = node.init
    }
  })
  if (!catalogueNode) {
    throw new Error('worksheetMetadata.js has no knownTemplateVersions')
  }
  const catalogue = {}
  const parserDescriptions = {}
  for (const [name, node] of parserFunctions) {
    const description = describeParser(node, parserFunctions)
    if (description) {
      parserDescriptions[name] = description
    }
  }
  for (const [templateKey, templateNode] of objectProperties(catalogueNode)) {
    const template = objectProperties(templateNode)
    const worksheets = {}
    for (const [sheetName, sheetNode] of objectProperties(template.get('worksheets'))) {
      const sheet = objectProperties(sheetNode)
      const mappingNode = sheet.get('mapping')
      worksheets[sheetName] = {
        target: sheet.get('target')?.value ?? null,
        firstRowOfData: sheet.get('firstRowOfData')?.value ?? null,
        mapping: mappingNode?.elements.map(mappingEntry) ?? []
      }
    }
    catalogue[templateKey] = {
      worksheets,
      transformRules: transformRulesFrom(template.get('transform'), transformFunctions)
    }
  }
  return { catalogue, parsers: parserDescriptions }
}

export const readOrganisationRulesFrom = async (orgDir) => {
  const base = path.join(orgDir, 'src/services/spreadsheetImport')
  return readOrganisationRules(await readFile(path.join(base, 'worksheetMetadata.js'), 'utf8'), await readFile(path.join(base, 'parsers.js'), 'utf8'), await readFile(path.join(base, 'transforms.js'), 'utf8'))
}

export const requireWorkbook = async (workbookPath) => {
  try {
    await access(workbookPath)
  } catch {
    throw new Error(`Workbook not found: ${workbookPath}`)
  }
}

export const cellValueText = (value) => {
  const plainText = (item) => item?.text ?? item
  const cell = value?.richText ?? value
  if (Array.isArray(cell)) {
    return cell.reduce((text, item) => text + plainText(item.richText ?? item), '')
  }
  return plainText(cell) ?? ''
}

export const readUtilsVersion = (lockfile) => {
  const version = lockfile.packages?.['node_modules/@defra/waste-movement-utils']?.version ?? lockfile.dependencies?.['@defra/waste-movement-utils']?.version
  if (!version) {
    throw new Error('package-lock.json has no @defra/waste-movement-utils version')
  }
  return version
}

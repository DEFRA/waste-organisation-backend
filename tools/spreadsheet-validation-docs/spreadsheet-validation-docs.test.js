import path from 'node:path'
import { readFile } from 'node:fs/promises'
import * as acorn from 'acorn'
import { base, full, recursive } from 'acorn-walk'
import { readOrganisationRules, requireWorkbook, workbookRelativePath } from './catalogue.js'
import { adviceFor, customConstantsFrom, joinSpreadsheetFields, messageCatalogFrom } from './schema-advice.js'
import { validationPatternLines } from './patterns.js'
import { buildSpreadsheetValidationMarkdown } from './render.js'
import { assertPublishVariables, publishMarkdown } from './confluence.js'

const repoRoot = path.resolve(import.meta.dirname, '../..')

const isFunction = (node) => node?.type === 'FunctionDeclaration' || node?.type === 'FunctionExpression' || node?.type === 'ArrowFunctionExpression'

const functionParams = (fn) => fn.params.flatMap((param) => (param.type === 'Identifier' ? [param.name] : []))

const thrownText = (node) => {
  if (node?.type === 'Literal' && typeof node.value === 'string') {
    return node.value
  }
  if (node?.type === 'TemplateLiteral') {
    return node.quasis.map((part) => part.value.cooked ?? '').join('…')
  }
  return null
}

const stringConstant = (node) => {
  if (node?.type === 'Literal' && typeof node.value === 'string') {
    return node.value
  }
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((part) => part.value.cooked ?? '').join('')
  }
  return null
}

const expectedThrownMessages = (source) => {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
  const constants = new Map()
  const messages = new Set()
  const unresolved = []
  const throwers = new Map()
  const seen = new Set()
  const recordThrown = (node, params, thrown) => {
    if (node.type !== 'NewExpression' || node.callee.type !== 'Identifier' || node.callee.name !== 'Error') {
      return
    }
    const argument = node.arguments[0]
    const text = thrownText(argument)
    if (text != null) {
      messages.add(text)
      return
    }
    if (argument?.type !== 'Identifier') {
      return
    }
    const index = params.indexOf(argument.name)
    if (index >= 0) {
      thrown.push(index)
    } else if (constants.has(argument.name)) {
      messages.add(constants.get(argument.name))
    } else {
      unresolved.push(argument.name)
    }
  }
  const scanFunction = (fn, name) => {
    if (seen.has(fn)) {
      return
    }
    seen.add(fn)
    const params = functionParams(fn)
    const thrown = []
    recursive(fn, null, {
      FunctionDeclaration(node, state, callback) {
        if (node !== fn) {
          scanFunction(node, node.id?.name ?? null)
          return
        }
        base.FunctionDeclaration(node, state, callback)
      },
      FunctionExpression(node, state, callback) {
        if (node !== fn) {
          scanFunction(node, node.id?.name ?? null)
          return
        }
        base.FunctionExpression(node, state, callback)
      },
      ArrowFunctionExpression(node, state, callback) {
        if (node !== fn) {
          scanFunction(node, null)
          return
        }
        base.ArrowFunctionExpression(node, state, callback)
      },
      VariableDeclarator(node, state, callback) {
        if (node.id.type === 'Identifier' && isFunction(node.init)) {
          scanFunction(node.init, node.id.name)
          return
        }
        base.VariableDeclarator(node, state, callback)
      },
      NewExpression(node, state, callback) {
        recordThrown(node, params, thrown)
        base.NewExpression(node, state, callback)
      }
    })
    if (name && thrown.length > 0) {
      throwers.set(name, thrown)
    }
  }
  full(ast, (node) => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
      const value = stringConstant(node.init)
      if (value != null) {
        constants.set(node.id.name, value)
      }
    }
  })
  recursive(ast, null, {
    FunctionDeclaration(node) {
      scanFunction(node, node.id?.name ?? null)
    },
    FunctionExpression(node) {
      scanFunction(node, node.id?.name ?? null)
    },
    ArrowFunctionExpression(node) {
      scanFunction(node, null)
    },
    VariableDeclarator(node, state, callback) {
      if (node.id.type === 'Identifier' && isFunction(node.init)) {
        scanFunction(node.init, node.id.name)
        return
      }
      base.VariableDeclarator(node, state, callback)
    }
  })
  full(ast, (node) => {
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && throwers.has(node.callee.name)) {
      for (const index of throwers.get(node.callee.name)) {
        const text = thrownText(node.arguments[index])
        if (text != null) {
          messages.add(text)
        }
      }
    }
  })
  if (unresolved.length > 0) {
    throw new Error(`Thrown message is not a string constant: ${unresolved.join(', ')}`)
  }
  return [...messages]
}

const described = {
  type: 'object',
  keys: {
    receiver: {
      type: 'object',
      keys: {
        siteName: {
          type: 'string',
          flags: { presence: 'required' },
          rules: [{ name: 'pattern', args: { regex: '/^Site/' } }]
        },
        authorisationNumber: {
          type: 'string',
          flags: { presence: 'required' },
          rules: [{ name: 'custom' }]
        }
      }
    },
    carrier: {
      type: 'object',
      keys: {
        vehicleRegistration: {
          type: 'any',
          whens: [
            {
              ref: { path: ['meansOfTransport'] },
              is: { type: 'string', flags: { presence: 'required', only: true }, allow: ['Road'] },
              then: { type: 'string', flags: { presence: 'required' } },
              otherwise: { type: 'any', flags: { presence: 'forbidden' } }
            }
          ]
        }
      }
    }
  }
}

const updateDescribed = {
  type: 'object',
  keys: {
    ...described.keys,
    wasteTrackingId: { type: 'string', flags: { presence: 'required' } }
  }
}

const catalogueEntry = {
  transformRules: [{ messages: ['Waste Tracking ID is required'], when: 'update', columnIndex: 6, sheetTarget: 'movements', path: ['wasteTrackingId'] }],
  worksheets: {
    '7. Waste movement level': {
      target: 'movements',
      mapping: [
        null,
        null,
        { path: ['receiver', 'siteName'], parserName: 'parseToString' },
        { path: ['carrier', 'vehicleRegistration'], parserName: null },
        { path: ['receiver', 'authorisationNumber'], parserName: null },
        null,
        { path: ['wasteTrackingId'], parserName: null },
        { path: ['carrier', 'meansOfTransport'], parserName: null }
      ]
    }
  }
}

const cells = {
  '7. Waste movement level': {
    5: { 1: '', 2: 'Mandatory', 3: 'Conditional mandatory', 4: 'Mandatory', 6: 'Optional', 7: 'Mandatory' },
    6: { 1: '', 2: 'Site name', 3: 'Vehicle registration', 4: 'Authorisation number', 6: 'Waste tracking ID', 7: 'Means of transport' },
    7: { 1: '', 2: 'Name of the site. For example ACME.', 3: 'Vehicle', 4: 'Authorisation', 6: 'Identifier', 7: 'How the waste was moved' }
  }
}

const cellText = (sheetName, row, column) => cells[sheetName]?.[row]?.[column] ?? ''

const field = (overrides = {}) => ({
  columnName: 'Example',
  sheetName: '7. Waste movement level',
  columnLetter: 'B',
  apiPath: 'example',
  obligation: 'Optional',
  description: '',
  parser: null,
  rules: [],
  presence: { create: { kind: 'optional' } },
  schema: {},
  ancestors: [],
  customConstants: [],
  examples: [],
  ...overrides
})

const movementFields = () =>
  joinSpreadsheetFields({
    catalogueEntry,
    cellText,
    createDescribed: described,
    updateDescribed,
    parsers: { parseToString: parserFacts([], ['Please provide a value']) },
    customConstants: {
      'receiver.authorisationNumber': {
        regexes: { ALL_SITE_AUTHORISATION_NUMBER_REGEXES: [/^AB\d$/] },
        errors: { AUTHORISATION_ERRORS: { INVALID: '{{#label}} must be in a valid UK format' } }
      }
    }
  })

const render = (fields) =>
  buildSpreadsheetValidationMarkdown({
    templateKey: 'Report receipt of waste',
    workbookPath: workbookRelativePath,
    organisationTag: '0.204.0',
    organisationCommit: 'abc',
    movementTag: '0.180.0',
    movementCommit: 'def',
    utilsVersion: '1.10.1',
    fields
  })

const sectionOf = (text, heading) => text.split(/^## /m).find((part) => part.startsWith(heading))

const movementSection = (letter) => sectionOf(render(movementFields()), `7. Waste movement level, column ${letter}`)

const parserAdvice = (parser) => adviceFor(field({ parser }), [], '8. Waste item level').map((record) => record.text)

const parserFacts = (patterns, messages = [], lists = {}) => ({ patterns, messages, lists })

const texts = (records) => records.map((record) => record.text)

describe('spreadsheet validation docs', () => {
  test('records a required field from the schema', () => {
    expect(movementFields().find((item) => item.apiPath === 'receiver.siteName').presence.create.kind).toBe('required')
  })

  test('renders a required field without api wording', () => {
    const site = movementSection('B')
    expect(site).toContain('**Column name:** Site name')
    expect(site).toContain('**Obligation:** Mandatory')
    expect(site).not.toContain('API path')
    expect(site).not.toContain('schema')
    expect(site).toContain('Site name cannot be left blank.')
    expect(site).toContain('- For example ACME.')
  })

  test('records a when condition from the schema', () => {
    expect(movementFields().find((item) => item.apiPath === 'carrier.vehicleRegistration').presence.create).toEqual({
      kind: 'conditional',
      whens: ['when meansOfTransport is "Road" then required', 'otherwise forbidden']
    })
  })

  test('renders a when condition as the obligation trigger', () => {
    const vehicle = movementSection('C')
    expect(vehicle).toContain('**Becomes mandatory when:** `Means of transport` is Road. Otherwise leave it blank.')
    expect(vehicle.split('**Checks:**')[1]).not.toContain('Fill in Vehicle registration')
    expect(vehicle).not.toContain('meansOfTransport')
  })

  test('renders a custom validator message without the raw pattern name', () => {
    const auth = movementSection('D')
    expect(auth).not.toContain('ALL_SITE_AUTHORISATION_NUMBER_REGEXES')
    expect(auth.split('**Errors:**')[0]).not.toContain('The error column says')
    expect(auth).toContain('**Errors:**')
    expect(auth.split('**Errors:**')[1]).toContain('Authorisation number must be in a valid UK format')
    expect(auth.split('**Errors:**')[1]).not.toContain('The error column says')
  })

  test('reads exported constants and regex literals from a source file', () => {
    const constants = customConstantsFrom(
      {
        ALL_SITE_AUTHORISATION_NUMBER_REGEXES: [/^X$/],
        AUTHORISATION_ERRORS: { INVALID: 'no' },
        CONSIGNMENT_ERRORS: { CODE_FORMAT: 'format' }
      },
      { 'src/schemas/hazardous-waste-consignment.js': 'const pattern = /^[A-Z]{2}$/ // AB' }
    )
    expect(constants['receiver.authorisationNumber'].regexes.ALL_SITE_AUTHORISATION_NUMBER_REGEXES[0]).toEqual(/^X$/)
    expect(constants.hazardousWasteConsignmentCode.errors.CONSIGNMENT_ERRORS.CODE_FORMAT).toBe('format')
    expect(constants.hazardousWasteConsignmentCode.regexes['src/schemas/hazardous-waste-consignment.js'][0]).toEqual(/^[A-Z]{2}$/)
    expect(constants.hazardousWasteConsignmentCode.samples).toEqual(['AB'])
  })

  test('omits an empty description', () => {
    const text = render([field({ columnLetter: 'J', columnName: 'Receiver phone number', description: '   ', apiPath: 'receiver.phone' })])
    expect(sectionOf(text, '7. Waste movement level, column J')).not.toContain('**Description:**')
  })

  test('says when a field has no validation', () => {
    const text = render([field({ columnLetter: 'J', columnName: 'Receiver phone number', apiPath: 'receiver.phone' })])
    expect(sectionOf(text, '7. Waste movement level, column J')).toContain('- There is no validation associated with this field.')
  })

  test('keeps a description and its example', () => {
    const text = render([
      field({
        columnLetter: 'R',
        columnName: 'Carrier address',
        description: 'The address of the carrier.',
        apiPath: 'carrier.address.fullAddress',
        examples: ['For example 1 High Street.']
      })
    ])
    const address = sectionOf(text, '7. Waste movement level, column R')
    expect(address).toContain('**Description:** The address of the carrier.')
    expect(address).toContain('- For example 1 High Street.')
  })

  test('states a conditional obligation taken from an error when the schema has no when', () => {
    const text = render([
      field({
        columnLetter: 'L',
        columnName: 'Hazardous waste consignment code',
        obligation: 'Conditional mandatory',
        apiPath: 'hazardousWasteConsignmentCode',
        rules: [{ name: 'consignment', messages: ['Hazardous waste consignment code is required when hazardous EWC codes are present'] }]
      })
    ])
    const sectionText = sectionOf(text, '7. Waste movement level, column L')
    expect(sectionText).toContain('**Becomes mandatory when:** hazardous EWC codes are present.')
    expect(sectionText.split('**Checks:**')[1]).not.toContain('Fill in Hazardous waste consignment code')
    expect(sectionText.split('**Errors:**')[1]).toContain('- Hazardous waste consignment code is required when hazardous EWC codes are present')
  })

  test('marks another column name mentioned in a condition', () => {
    const text = render([
      field({
        columnLetter: 'M',
        columnName: 'Give reasons for not having a consignment number',
        obligation: 'Conditional mandatory',
        apiPath: 'reasonForNoConsignmentCode',
        rules: [{ name: 'reason', messages: ['Give reasons for not having a consignment number is required when EWC code contains a hazardous code and Hazardous waste consignment code is not provided'] }]
      }),
      field({ columnLetter: 'C', columnName: 'EWC code', sheetName: '8. Waste item level', apiPath: 'wasteItems.ewcCodes', obligation: 'Mandatory' }),
      field({ columnLetter: 'L', columnName: 'Hazardous waste consignment code', apiPath: 'hazardousWasteConsignmentCode', obligation: 'Conditional mandatory' })
    ])
    const reason = sectionOf(text, '7. Waste movement level, column M')
    expect(reason).toContain('**Becomes mandatory when:** `EWC code` contains a hazardous code and `Hazardous waste consignment code` is not provided.')
  })

  test('lists the error column', () => {
    expect(movementSection('A')).toContain('Do not type in it.')
  })

  test('skips empty mappings other than the error column', () => {
    expect(render(movementFields())).not.toContain('column E')
  })

  test('renders the waste tracking id update rule', () => {
    const tracking = movementSection('F')
    expect(tracking).not.toContain('no schema node')
    expect(tracking).toContain('When updating a movement, Waste tracking ID must be filled in.')
  })

  test('writes a postcode rule without the raw pattern', () => {
    const postcode = texts(
      adviceFor(
        field({
          columnName: 'Site postcode',
          apiPath: 'receipt.address.postcode',
          presence: { create: { kind: 'required' } },
          schema: {
            create: {
              type: 'string',
              flags: { presence: 'required' },
              rules: [{ name: 'pattern', message: { template: '{{#label}} must be in valid UK format' }, args: { regex: '/^post$/' } }]
            }
          }
        }),
        [],
        '8. Waste item level'
      )
    )
    expect(postcode).toContain('Site postcode cannot be left blank.')
    expect(postcode).toContain('Site postcode must be in valid UK format')
    expect(postcode.join('\n')).not.toContain('/^post$/')
  })

  test('writes an array limit as values rather than characters', () => {
    const codes = texts(
      adviceFor(
        field({
          columnName: 'EWC code',
          sheetName: '8. Waste item level',
          apiPath: 'wasteItems.ewcCodes',
          parser: parserFacts(['/[,;]/'], ['Cannot parse EWC codes']),
          presence: { create: { kind: 'required' } },
          schema: {
            create: {
              type: 'array',
              flags: { presence: 'required' },
              rules: [{ name: 'max', args: { limit: 5 } }],
              preferences: { messages: { 'array.max': '{{#label}} must contain no more than 5 EWC codes' } },
              items: [{ type: 'string', rules: [{ name: 'custom' }], preferences: { messages: { 'InvalidFormat.ewcCode': '{{#label}} must be a valid 6-digit numeric code' } } }]
            }
          }
        }),
        [],
        '8. Waste item level'
      )
    )
    expect(codes).toContain('At least one value is required.')
    expect(codes).toContain('EWC code must contain no more than 5 EWC codes')
    expect(codes).toContain('EWC code must be a valid 6-digit numeric code')
    expect(codes.join('\n')).not.toContain('characters')
  })

  test('writes an email rule without requiring the field', () => {
    const email = texts(
      adviceFor(
        field({
          columnName: 'Receiver email',
          apiPath: 'receiver.emailAddress',
          schema: { create: { type: 'string', rules: [{ name: 'email' }] } }
        }),
        [],
        '8. Waste item level'
      )
    )
    expect(email).toContain('Receiver email must be an email address.')
    expect(email.join('\n')).not.toContain('cannot be left blank')
  })

  test('writes whole-number and minimum rules', () => {
    const containers = texts(
      adviceFor(
        field({
          columnName: 'Number of containers used',
          sheetName: '8. Waste item level',
          apiPath: 'wasteItems.numberOfContainers',
          presence: { create: { kind: 'required' } },
          schema: { create: { type: 'number', flags: { presence: 'required' }, rules: [{ name: 'integer' }, { name: 'min', args: { limit: 0 } }] } }
        }),
        [],
        '8. Waste item level'
      )
    )
    expect(containers).toContain('Number of containers used cannot be left blank.')
    expect(containers).toContain('Must be a whole number.')
    expect(containers).toContain('Must be zero or greater.')
  })

  test('allows a blank registration number when the schema allows it', () => {
    const registration = texts(
      adviceFor(
        field({
          columnName: 'Carrier registration number',
          apiPath: 'carrier.registrationNumber',
          presence: { create: { kind: 'required' } },
          schema: { create: { type: 'alternatives', flags: { presence: 'required' }, allow: [null, ''], preferences: { messages: { 'alternatives.match': '{{#label}} must be in a valid England, SEPA, NRW or NI format' } } } }
        }),
        [],
        '8. Waste item level'
      )
    )
    expect(registration).toContain('Carrier registration number must be in a valid England, SEPA, NRW or NI format')
    expect(registration.join('\n')).not.toContain('cannot be left blank')
  })

  test('describes a comma or semicolon separator', () => {
    expect(parserAdvice(parserFacts(['/[,;]/']))).toContain('More than one value can be entered, separated by a comma or a semicolon.')
  })

  test('describes a semicolon separator', () => {
    expect(parserAdvice(parserFacts(['/;/']))).toContain('More than one value can be entered, separated by a semicolon.')
  })

  test('describes a semicolon separator alongside another pattern', () => {
    expect(parserAdvice(parserFacts(['/;/', '/([^=]*)=(.*)/']))).toContain('More than one value can be entered, separated by a semicolon.')
  })

  test('describes a date parser', () => {
    expect(parserAdvice(parserFacts(['/\\d{4}/']))).toContain('Example is read as a date written day/month/year. A time can be included. A year-month-day date is also accepted.')
  })

  test('describes a square-bracket code parser', () => {
    expect(parserAdvice(parserFacts(['/\\[/']))).toContain('A code in square brackets at the start of the cell is used. Text after the code is ignored.')
  })

  test('describes a hazardous property code parser', () => {
    expect(parserAdvice(parserFacts(['/HP/']))).toContain('A hazardous property code is written as HP followed by a number. Spaces or underscores between HP and the number are ignored.')
  })

  test('describes weight units from a parser conversion table', () => {
    expect(parserAdvice(parserFacts([], [], { metricConversions: { g: 'Grams', kg: 'Kilograms' } }))).toContain('A weight unit can be written as g (read as Grams), kg (read as Kilograms).')
  })

  test('describes a disposal code parser', () => {
    expect(parserAdvice(parserFacts(['/[A-Z]/'], [], { metricConversions: { g: 'Grams' } }))).toContain(
      'A code on its own applies to the whole item. Otherwise each entry is a code, an amount, a unit, and whether the amount is estimated, separated by = signs. Several entries are separated by semicolons.'
    )
  })

  test('describes a concentration parser', () => {
    expect(parserAdvice(parserFacts(['/([^=]*)=(.*)/']))).toContain('Each entry is a code or name, an equals sign, and a concentration. Several entries are separated by semicolons.')
  })

  test('describes every validation pattern and prefers a real example', () => {
    const lines = validationPatternLines([/^[A-Z]{2}\d{4}[A-Z]{2}$/i, /^EAWML\d{5,6}$/i, /^CBD[LU]\d{3,}$/i], ['HP3456XX', 'EAWML-10001', 'CBDL999'])
    expect(lines).toContain('Letters may be upper or lower case.')
    expect(lines).toContain('Two letters, then four digits, then two letters, for example HP3456XX.')
    expect(lines).toContain('EAWML, then five or six digits, for example EAWML11111.')
    expect(lines).toContain('CBD, then L or U, then three or more digits, for example CBDL999.')
    expect(lines.join('\n')).not.toContain('EAWML-10001')
    expect(lines.join('\n')).not.toContain('[A-Z]')
  })

  test('writes conditional component rules from the parent schema', () => {
    const source = field({
      columnName: 'How did you determine the POPs components?',
      sheetName: '8. Waste item level',
      apiPath: 'wasteItems.pops.sourceOfComponents',
      schema: { create: { type: 'string', flags: { only: true }, allow: ['PROVIDED_WITH_WASTE', 'GUIDANCE', 'OWN_TESTING', 'NOT_PROVIDED'] } }
    })
    const pops = field({
      columnName: 'Does the waste contain persistent organic pollutants (POPs)?',
      sheetName: '8. Waste item level',
      apiPath: 'wasteItems.containsPops'
    })
    const lines = adviceFor(
      field({
        columnName: 'POP name & concentration value',
        sheetName: '8. Waste item level',
        apiPath: 'wasteItems.pops.components',
        parser: parserFacts(['/;/', '/([^=]*)=(.*)/'], ['Cannot parse component codes']),
        schema: {
          create: {
            type: 'array',
            preferences: { messages: { 'BusinessRuleViolation.componentsNotAllowed': '{{#message}}', 'BusinessRuleViolation.componentsNotAllowedWhenFalse': '{{#message}}' } }
          }
        },
        ancestors: [
          {
            type: 'object',
            preferences: { messages: { 'BusinessRuleViolation.componentsRequired': '{{#message}}', 'BusinessRuleViolation.sourceOfComponentsRequired': '{{#message}}' } },
            whens: [{ ref: { path: ['containsPops'] }, is: { type: 'any', flags: { presence: 'required', only: true }, allow: [true] }, then: { type: 'any', flags: { presence: 'required' } } }]
          }
        ],
        messageCatalog: messageCatalogFrom({
          POPS_OR_HAZARDOUS_ERRORS: { COMPONENTS_NOT_ALLOWED_NOT_PROVIDED: '{{#label}} must not be provided when sourceOfComponents is NOT_PROVIDED' },
          POPS_ERRORS: {
            REQUIRED_WHEN_CONTAINS_POPS_TRUE: '{{#label}} is required when containsPops is true',
            COMPONENTS_NOT_ALLOWED_FALSE: '{{#label}} must not be provided when containsPops is false'
          },
          HAZARDOUS_ERRORS: {}
        })
      }),
      [source, pops],
      '8. Waste item level'
    )
    const sentences = texts(lines)
    expect(sentences).toContain('Fill in POP name & concentration value when How did you determine the POPs components? is GUIDANCE or OWN_TESTING.')
    expect(sentences).toContain('POP name & concentration value must not be provided when How did you determine the POPs components? is NOT_PROVIDED')
    expect(sentences).toContain('POP name & concentration value must not be provided when Does the waste contain persistent organic pollutants (POPs)? is no')
    expect(sentences).toContain('Each entry is a code or name, an equals sign, and a concentration. Several entries are separated by semicolons.')
    expect(sentences.join('\n')).not.toContain('is yes')
  })

  test('keeps both messages thrown by one transform', () => {
    const metadata = `
      const knownTemplateVersions = {
        'Report receipt of waste': {
          worksheets: {},
          transform: (data) => validateBoth(2)
        }
      }
    `
    const transforms = `
      export const validateBoth = () => {
        throw new Error('First problem')
        throw new Error('Second problem')
      }
    `
    const rules = readOrganisationRules(metadata, '', transforms)
    const rule = rules.catalogue['Report receipt of waste'].transformRules.find((item) => item.name === 'validateBoth')
    const records = texts(adviceFor(field({ rules: [rule] }), [], '8. Waste item level'))
    expect(records).toContain('First problem')
    expect(records).toContain('Second problem')
  })

  test('keeps a colon inside a custom error message', () => {
    const fields = joinSpreadsheetFields({
      catalogueEntry: {
        worksheets: {
          '7. Waste movement level': {
            target: 'movements',
            mapping: [null, null, null, null, { path: ['receiver', 'authorisationNumber'], parserName: null }]
          }
        },
        transformRules: []
      },
      cellText: () => 'Authorisation number',
      createDescribed: {
        type: 'object',
        keys: { receiver: { type: 'object', keys: { authorisationNumber: { type: 'string', rules: [{ name: 'custom' }] } } } }
      },
      updateDescribed: {},
      parsers: {},
      customConstants: {
        'receiver.authorisationNumber': {
          errors: { AUTHORISATION_ERRORS: { INVALID: '{{#label}} must match a format: EA/NRW' } }
        }
      }
    })
    const authorisation = fields.find((item) => item.apiPath === 'receiver.authorisationNumber')
    expect(texts(adviceFor(authorisation, fields, '8. Waste item level'))).toContain('Authorisation number must match a format: EA/NRW')
  })

  test('throws when the workbook is missing', async () => {
    const missing = path.join(import.meta.dirname, 'missing-receipt-of-waste-template.xlsx')
    await expect(requireWorkbook(missing)).rejects.toThrow(`Workbook not found: ${missing}`)
  })

  test('follows a thrown string constant and a string passed to a helper', () => {
    const parsers = `
      const invalidConcentrationMessage = 'Invalid concentration'
      const rethrowComponentParseError = (error, fallback) => {
        throw new Error(fallback)
      }
      const parseConcentration = () => {
        throw new Error(invalidConcentrationMessage)
      }
      export const parseComponentCodes = (existing, data) => {
        try {
          return parseConcentration(data)
        } catch (error) {
          rethrowComponentParseError(error, 'Cannot parse component codes')
        }
      }
      export const parseComponentNames = (existing, data) => {
        rethrowComponentParseError(data, 'Cannot parse component names')
      }
    `
    const metadata = "const knownTemplateVersions = { 'Report receipt of waste': { worksheets: {} } }"
    const rules = readOrganisationRules(metadata, parsers, '')
    expect(rules.parsers.parseComponentCodes.messages).toContain('Cannot parse component codes')
    expect(rules.parsers.parseComponentCodes.messages).toContain('Invalid concentration')
    expect(rules.parsers.parseComponentNames.messages).toContain('Cannot parse component names')
    expect(rules.parsers.parseComponentNames.messages).not.toContain('Cannot parse component codes')
  })

  test('reads the catalogue and parser tables from the service source as it stands', async () => {
    const base = path.join(repoRoot, 'src/services/spreadsheetImport')
    const parsersSource = await readFile(path.join(base, 'parsers.js'), 'utf8')
    const transformsSource = await readFile(path.join(base, 'transforms.js'), 'utf8')
    const rules = readOrganisationRules(await readFile(path.join(base, 'worksheetMetadata.js'), 'utf8'), parsersSource, transformsSource)
    const template = rules.catalogue['Report receipt of waste']
    const movement = template.worksheets['7. Waste movement level']
    const found = [...Object.values(rules.parsers).flatMap((parser) => parser?.messages ?? []), ...template.transformRules.flatMap((rule) => rule.messages ?? [])]
    expect(movement.mapping[2]).toEqual({ path: ['wasteTrackingId'], parserName: 'parseToString' })
    expect(movement.mapping[3].parserName).toBe('requiredString')
    expect(rules.parsers.parseEstimate.lists.estVals).toContain('estimate')
    expect(rules.parsers.parseEstimate.lists.actVals).toContain('actual')
    expect(rules.parsers.requiredString.messages).toContain('Please provide a value')
    expect(rules.parsers.correctDateTimezone.patterns.length).toBeGreaterThan(0)
    expect(rules.parsers.parseComponentCodes.messages).toContain('Cannot parse component codes')
    expect(rules.parsers.parseComponentCodes.messages).toContain('Invalid concentration')
    expect(rules.parsers.parseComponentNames.messages).toContain('Cannot parse component names')
    expect(rules.parsers.parseComponentNames.messages).toContain('Invalid concentration')
    for (const message of [...expectedThrownMessages(parsersSource), ...expectedThrownMessages(transformsSource)]) {
      expect(found).toContain(message)
    }
    expect(template.transformRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messages: ['Waste Tracking ID is required'], when: 'update', columnIndex: 2, path: ['wasteTrackingId'] }),
        expect.objectContaining({ messages: ['Waste Tracking ID must not be present on a create upload'], when: 'create', columnIndex: 2 }),
        expect.objectContaining({ messages: ['No waste items for unique reference'], columnIndex: 3, path: ['yourUniqueReference'] }),
        expect.objectContaining({ messages: ['Duplicate reference'], columnIndex: 3 }),
        expect.objectContaining({ path: ['carrier', 'registrationNumber'], literals: expect.arrayContaining(['""']) }),
        expect.objectContaining({ path: ['disposalOrRecoveryCodes'], sheetTarget: 'items', literals: expect.arrayContaining([expect.stringContaining('whole item')]) })
      ])
    )
  })

  test('names each Confluence variable that is not set', () => {
    expect(() => assertPublishVariables({})).toThrow('Set CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN and CONFLUENCE_PAGE_ID before publishing to Confluence.')
    expect(() => assertPublishVariables({ CONFLUENCE_BASE_URL: 'https://example.atlassian.net/wiki', CONFLUENCE_EMAIL: ' ', CONFLUENCE_API_TOKEN: 'token', CONFLUENCE_PAGE_ID: '99' })).toThrow('Set CONFLUENCE_EMAIL before publishing to Confluence.')
  })

  test('publishes the markdown as the next Confluence page version', async () => {
    const calls = []
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, options })
      if (options.method === 'PUT') {
        return { ok: true, status: 200, text: async () => JSON.stringify({ version: { number: 5 } }) }
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ title: 'Spreadsheet validation rules', version: { number: 4 } }) }
    }
    const published = await publishMarkdown('# Spreadsheet validation rules\n\n**Column name:** Site name', publishEnv, fetchImpl)
    expect(published).toEqual({ title: 'Spreadsheet validation rules', version: 5 })
    expect(calls[0].url).toBe('https://example.atlassian.net/wiki/api/v2/pages/99')
    expect(calls[0].options.headers.Authorization).toBe(`Basic ${Buffer.from('ada@example.com:secret-token').toString('base64')}`)
    const body = JSON.parse(calls[1].options.body)
    expect(body).toMatchObject({
      id: '99',
      status: 'current',
      title: 'Spreadsheet validation rules',
      version: { number: 5 }
    })
    expect(body.body.representation).toBe('storage')
    expect(body.body.value).toContain('<h1>Spreadsheet validation rules</h1>')
    expect(body.body.value).toContain('<strong>Column name:</strong> Site name')
  })

  test('reports the status when Confluence rejects the update', async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' })
    await expect(publishMarkdown('# Title', publishEnv, fetchImpl)).rejects.toThrow('Confluence GET https://example.atlassian.net/wiki/api/v2/pages/99 failed (401): unauthorized')
  })
})

const publishEnv = {
  CONFLUENCE_BASE_URL: 'https://example.atlassian.net/wiki/',
  CONFLUENCE_EMAIL: 'ada@example.com',
  CONFLUENCE_API_TOKEN: 'secret-token',
  CONFLUENCE_PAGE_ID: '99'
}

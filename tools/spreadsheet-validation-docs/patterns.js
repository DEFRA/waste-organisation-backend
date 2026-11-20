import * as acorn from 'acorn'
import { RegExpParser } from '@eslint-community/regexpp'
import { walk } from './catalogue.js'

const check = (text) => ({ kind: 'check', text })

export const regexesInSource = (source) => {
  const comments = []
  const ast = acorn.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    onComment: (_block, text) => comments.push(text)
  })
  const regexes = []
  walk(ast, (node) => {
    if (node.type === 'Literal' && node.regex) {
      regexes.push(new RegExp(node.regex.pattern, node.regex.flags))
    } else if (node.type === 'Literal' && node.value instanceof RegExp) {
      regexes.push(node.value)
    }
  })
  const unique = []
  const seen = new Set()
  for (const regex of regexes) {
    const key = `${regex.source}/${regex.flags}`
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(regex)
    }
  }
  const samples = []
  for (const token of comments.join(' ').split(/[^A-Za-z0-9/]+/)) {
    if (token && unique.some((regex) => regex.test(token)) && !samples.includes(token)) {
      samples.push(token)
    }
  }
  return { regexes: unique, samples }
}

export const parserSentences = (parser, columnName) => {
  if (!parser) {
    return []
  }
  const lines = []
  const patterns = parser.patterns ?? []
  const has = (part) => patterns.some((pattern) => pattern.includes(part))
  if (has('[,;]')) {
    lines.push(check('More than one value can be entered, separated by a comma or a semicolon.'))
  } else if (patterns.some((pattern) => pattern === '/;/')) {
    lines.push(check('More than one value can be entered, separated by a semicolon.'))
  }
  if (has('\\d{4}')) {
    lines.push(check(`${columnName} is read as a date written day/month/year. A time can be included. A year-month-day date is also accepted.`))
  }
  if (has('\\[')) {
    lines.push(check('A code in square brackets at the start of the cell is used. Text after the code is ignored.'))
  }
  if (has('HP')) {
    lines.push(check('A hazardous property code is written as HP followed by a number. Spaces or underscores between HP and the number are ignored.'))
  }
  if (parser.lists?.metricConversions) {
    const grouped = Object.groupBy(Object.entries(parser.lists.metricConversions), ([, target]) => target)
    const parts = Object.entries(grouped).map(([target, pairs]) => `${pairs.map(([source]) => source).join(' or ')} (read as ${target})`)
    if (parts.length > 0) {
      lines.push(check(`A weight unit can be written as ${parts.join(', ')}.`))
    }
    if (has('[A-Z]')) {
      lines.push(check('A code on its own applies to the whole item. Otherwise each entry is a code, an amount, a unit, and whether the amount is estimated, separated by = signs. Several entries are separated by semicolons.'))
    }
  }
  if (has('[^=]')) {
    lines.push(check('Each entry is a code or name, an equals sign, and a concentration. Several entries are separated by semicolons.'))
  }
  return lines
}

const countWord = (number) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][number] ?? String(number)

export const describedRegex = (value) => {
  if (value instanceof RegExp) {
    return value
  }
  const match = String(value).match(/^\/([\s\S]*)\/([a-z]*)$/)
  return match ? new RegExp(match[1], match[2]) : null
}

const unsupported = () => {
  throw new Error('unparsed pattern')
}

const characterText = (node) => String.fromCodePoint(node.value)

const classNode = (chars) => {
  const digits = chars.length > 0 && chars.every((char) => /\d/.test(char))
  const letters = chars.length > 0 && chars.every((char) => /[A-Za-z]/.test(char))
  if (digits) {
    return { type: 'digit' }
  }
  if (letters && chars.length >= 20) {
    return { type: 'letter' }
  }
  if (chars.length > 8) {
    return { type: 'set', label: letters ? 'a letter' : 'a letter or digit', example: chars.find((char) => /[A-Za-z]/.test(char)) ?? chars[0] ?? 'A' }
  }
  const label = chars.join(', ')
  return { type: 'set', label, example: chars[0] ?? 'A' }
}

const classChars = (characterClass) => {
  const chars = []
  for (const element of characterClass.elements) {
    if (element.type === 'Character') {
      chars.push(characterText(element))
    } else if (element.type === 'CharacterClassRange') {
      for (let code = element.min.value; code <= element.max.value; code += 1) {
        chars.push(String.fromCodePoint(code))
      }
    } else if (element.type === 'CharacterSet' && element.kind === 'digit' && !element.negate) {
      chars.push('0')
    } else {
      unsupported()
    }
  }
  return [...new Set(chars)]
}

const mergeParts = (parts) => {
  const merged = []
  for (const part of parts) {
    const previous = merged.at(-1)
    if (part.type === 'lit' && previous?.type === 'lit') {
      previous.value += part.value
    } else {
      merged.push(part)
    }
  }
  if (merged.length === 0) {
    unsupported()
  }
  return merged.length === 1 ? merged[0] : { type: 'seq', parts: merged }
}

const fromElements = (elements) => mergeParts(elements.map(fromElement))

const fromAlternatives = (alternatives) => {
  const options = alternatives.map(fromAlternative)
  return options.length === 1 ? options[0] : { type: 'alt', options }
}

const withoutOuterAnchors = (elements) => {
  let remaining = elements
  if (remaining[0]?.type === 'Assertion' && remaining[0].kind === 'start') {
    remaining = remaining.slice(1)
  }
  if (remaining.at(-1)?.type === 'Assertion' && remaining.at(-1).kind === 'end') {
    remaining = remaining.slice(0, -1)
  }
  return remaining
}

const fromElement = (element) => {
  if (element.type === 'Character') {
    return { type: 'lit', value: characterText(element) }
  }
  if (element.type === 'CharacterSet') {
    if (element.kind === 'digit' && !element.negate) {
      return { type: 'digit' }
    }
    if (element.kind === 'word' && !element.negate) {
      return { type: 'set', label: 'a letter, digit or underscore', example: 'A' }
    }
    if (element.kind === 'word' && element.negate) {
      return { type: 'set', label: 'a symbol', example: ' ' }
    }
    if (element.kind === 'space' && !element.negate) {
      return { type: 'lit', value: ' ' }
    }
    if (element.kind === 'any') {
      return { type: 'set', label: 'any character', example: 'A' }
    }
    unsupported()
  }
  if (element.type === 'CharacterClass') {
    return classNode(classChars(element))
  }
  if (element.type === 'Quantifier') {
    return { type: 'repeat', body: fromElement(element.element), min: element.min, max: Number.isFinite(element.max) ? element.max : null }
  }
  if (element.type === 'CapturingGroup' || element.type === 'Group') {
    return fromAlternatives(element.alternatives)
  }
  unsupported()
}

const fromAlternative = (alternative) => fromElements(withoutOuterAnchors(alternative.elements))

const patternTree = (regex) => {
  const pattern = new RegExpParser().parsePattern(regex.source, 0, regex.source.length, { unicode: regex.unicode, unicodeSets: regex.unicodeSets })
  return fromAlternatives(pattern.alternatives)
}

const describeRepeat = (body, min, max) => {
  if (body.type === 'lit' && min === max) {
    return body.value.repeat(min)
  }
  if (body.type === 'lit' && min === 0 && max === 1) {
    return `an optional ${body.value}`
  }
  const singular = body.type === 'digit' ? 'digit' : body.type === 'letter' ? 'letter' : (body.label ?? describePatternNode(body))
  const plural = body.type === 'digit' ? 'digits' : body.type === 'letter' ? 'letters' : singular.startsWith('a ') ? singular.slice(2).replace(/\b([a-z]+)\b/g, (word) => (word === 'or' || word === 'and' || word.endsWith('s') ? word : `${word}s`)) : singular
  const name = [singular, plural]
  if (min === 0 && max === 1) {
    return `an optional ${name[0]}`
  }
  if (min === 0 && max == null) {
    return `any number of ${name[1]}`
  }
  if (min === 1 && max == null) {
    return `one or more ${name[1]}`
  }
  if (max == null) {
    return `${countWord(min)} or more ${name[1]}`
  }
  if (min === max) {
    return `${countWord(min)} ${min === 1 ? name[0] : name[1]}`
  }
  if (max === min + 1) {
    return `${countWord(min)} or ${countWord(max)} ${name[1]}`
  }
  return `${countWord(min)} to ${countWord(max)} ${name[1]}`
}

const describePatternNode = (node) => {
  if (!node) {
    return ''
  }
  if (node.type === 'lit') {
    const leading = node.value.length - node.value.trimStart().length
    const trailing = node.value.length - node.value.trimEnd().length
    const core = node.value.trim()
    const space = (count) => (count === 1 ? 'a space' : `${countWord(count)} spaces`)
    return [leading > 0 ? space(leading) : null, core || null, trailing > 0 ? space(trailing) : null].filter(Boolean).join(', then ') || 'a space'
  }
  if (node.type === 'digit') {
    return 'a digit'
  }
  if (node.type === 'letter') {
    return 'a letter'
  }
  if (node.type === 'set') {
    return node.label.includes(',') ? node.label.replace(/, ([^,]+)$/, ' or $1') : node.label
  }
  if (node.type === 'repeat') {
    return describeRepeat(node.body, node.min, node.max)
  }
  if (node.type === 'seq') {
    return node.parts.map(describePatternNode).join(', then ')
  }
  if (node.type === 'alt') {
    const literal = (option) => option.type === 'lit' || option.type === 'set'
    if (node.options.every(literal)) {
      const parts = node.options.map(describePatternNode)
      return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} or ${parts.at(-1)}`
    }
    return node.options.map(describePatternNode).join('; or ')
  }
  return ''
}

const repeatText = (text, count) => (count > 0 ? text.repeat(count) : '')

const exampleFromNode = (node) => {
  if (!node) {
    return ''
  }
  if (node.type === 'lit') {
    return node.value
  }
  if (node.type === 'digit') {
    return '1'
  }
  if (node.type === 'letter') {
    return 'A'
  }
  if (node.type === 'set') {
    return node.example
  }
  if (node.type === 'repeat') {
    return repeatText(exampleFromNode(node.body), node.min === 0 ? 0 : node.min)
  }
  if (node.type === 'seq') {
    return node.parts.map(exampleFromNode).join('')
  }
  if (node.type === 'alt') {
    return exampleFromNode(node.options[0])
  }
  return ''
}

const patternLine = (regex, samples) => {
  let parsed = null
  let description = null
  let generated = null
  try {
    parsed = patternTree(regex)
    description = describePatternNode(parsed)
    generated = exampleFromNode(parsed)
  } catch {
    parsed = null
  }
  const uppercase = (value) => [...value].filter((char) => char >= 'A' && char <= 'Z').length
  const sample = samples.filter((value) => value.length <= 40 && regex.test(value)).sort((left, right) => left.length - right.length || uppercase(right) - uppercase(left) || left.localeCompare(right))[0]
  const forms = []
  const add = (value) => {
    if (value && regex.test(value) && !forms.includes(value)) {
      forms.push(value)
    }
  }
  add(sample)
  if (parsed?.type === 'alt') {
    for (const option of parsed.options) {
      add(exampleFromNode(option))
    }
  } else if (!sample) {
    add(generated)
  }
  const finish = (sentence) => sentence.charAt(0).toUpperCase() + sentence.slice(1)
  if (description && description.length <= 180) {
    if (forms[0]) {
      return finish(`${description}, for example ${forms[0]}.`)
    }
    return finish(`${description}.`)
  }
  if (forms.length > 1) {
    return finish(`Accepted forms include ${forms.slice(0, 4).join(', ')}.`)
  }
  if (forms.length === 1) {
    return finish(`An accepted form is ${forms[0]}.`)
  }
  return null
}

export const validationPatternLines = (regexes = [], samples = []) => {
  const unique = []
  const seen = new Set()
  for (const regex of regexes) {
    const key = `${regex.source}/${regex.flags}`
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(regex)
    }
  }
  const lines = unique.map((regex) => patternLine(regex, samples)).filter(Boolean)
  if (lines.length > 0 && unique.every((regex) => regex.flags.includes('i'))) {
    lines.unshift('Letters may be upper or lower case.')
  }
  return lines
}

export const patternSamplesFrom = (utils) => {
  const samples = []
  const visit = (value, depth) => {
    if (depth > 6 || samples.length > 5000) {
      return
    }
    if (typeof value === 'string' && value.length > 0 && value.length <= 40 && !value.includes('\n')) {
      samples.push(value)
    } else if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1)
      }
    } else if (value && typeof value === 'object' && !(value instanceof RegExp)) {
      for (const item of Object.values(value)) {
        visit(item, depth + 1)
      }
    }
  }
  visit(utils, 0)
  return [...new Set(samples)]
}

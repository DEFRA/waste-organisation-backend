import { adviceFor } from './schema-advice.js'

const markOtherColumns = (text, fields, columnName) => {
  const own = columnName?.trim()
  const names = [...new Set(fields.map((field) => field.columnName?.trim()).filter((name) => name && name !== own))].sort((left, right) => right.length - left.length)
  if (names.length === 0 || !text) {
    return text
  }
  const pattern = new RegExp(`(?<![A-Za-z0-9])(?:${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![A-Za-z0-9])`, 'g')
  return text
    .split('`')
    .map((part, index) => (index % 2 === 1 ? part : part.replace(pattern, (match) => `\`${match}\``)))
    .join('`')
}

const renderField = (field, fields, itemSheetName) => {
  const lines = [`## ${field.sheetName}, column ${field.columnLetter}`, '', `**Column name:** ${field.columnName}`, '', `**Obligation:** ${field.obligation}`]
  const conditional = /conditional/i.test(field.obligation ?? '')
  const conditions = []
  const addCondition = (text) => {
    const phrase = text.replace(/\.$/, '')
    if (phrase && !conditions.includes(phrase)) {
      conditions.push(phrase)
    }
  }
  const conditionPhrase = (line) => {
    const fillIn = `Fill in ${field.columnName} when `
    if (line.startsWith(fillIn)) {
      return line.slice(fillIn.length)
    }
    if (line === `Otherwise leave ${field.columnName} blank.`) {
      return 'Otherwise leave it blank'
    }
    const leave = `Leave ${field.columnName} blank when `
    if (line.startsWith(leave)) {
      return `Leave it blank when ${line.slice(leave.length)}`
    }
    return null
  }
  const advice = adviceFor(field, fields, itemSheetName)
  const checks = []
  const errors = advice.filter((record) => record.kind === 'error')
  for (const record of advice) {
    if (record.kind === 'error') {
      continue
    }
    const phrase = conditional && record.kind === 'condition' ? conditionPhrase(record.text) : null
    if (phrase) {
      addCondition(phrase)
    } else {
      checks.push(record.text)
    }
  }
  const requiredWhen = `${field.columnName} is required when `
  if (conditional && !advice.some((record) => record.kind === 'condition')) {
    for (const record of errors) {
      if (record.text.startsWith(requiredWhen)) {
        addCondition(record.text.slice(requiredWhen.length))
      }
    }
  }
  for (const record of errors) {
    const accepted = record.text.match(/must be one of: (.+)$/)?.[1]
    const acceptedSentence = accepted ? `The upload accepts: ${accepted}.` : null
    if (acceptedSentence && !checks.some((item) => item.startsWith('The upload accepts:'))) {
      checks.push(acceptedSentence)
    }
  }
  if (conditions.length > 0) {
    lines.push('', `**Becomes mandatory when:** ${markOtherColumns(conditions.join('. '), fields, field.columnName)}.`)
  }
  if (field.description?.trim()) {
    lines.push('', `**Description:** ${markOtherColumns(field.description, fields, field.columnName)}`)
  }
  lines.push('', '**Checks:**', '')
  const checkLines = checks.length > 0 ? checks : ['There is no validation associated with this field.']
  for (const line of checkLines) {
    lines.push(`- ${markOtherColumns(line, fields, field.columnName)}`)
  }
  if (errors.length > 0) {
    lines.push('', '**Errors:**', '')
    for (const record of errors) {
      lines.push(`- ${markOtherColumns(record.text, fields, field.columnName)}`)
    }
  }
  if (field.examples.length > 0) {
    lines.push('', '**Examples:**', '')
    for (const example of field.examples) {
      lines.push(`- ${markOtherColumns(example, fields, field.columnName)}`)
    }
  }
  return lines
}

export const buildSpreadsheetValidationMarkdown = ({ templateKey, workbookPath, organisationTag, organisationCommit, movementTag, movementCommit, utilsVersion, fields }) => {
  const lines = [
    '# Spreadsheet validation rules',
    '',
    `- Workbook A1: ${templateKey}`,
    `- Workbook path: ${workbookPath}`,
    `- Organisation backend tag: ${organisationTag}`,
    `- Organisation backend commit: ${organisationCommit}`,
    `- Movement backend tag: ${movementTag}`,
    `- Movement backend commit: ${movementCommit}`,
    `- @defra/waste-movement-utils: ${utilsVersion}`,
    ''
  ]
  const itemSheetName = fields.find((field) => field.apiPath.startsWith('wasteItems.'))?.sheetName ?? 'the waste item sheet'
  for (const field of fields) {
    lines.push(...renderField(field, fields, itemSheetName), '')
  }
  return `${lines.join('\n').replace(/\n$/, '')}\n`
}

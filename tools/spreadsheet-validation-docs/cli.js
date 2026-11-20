import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import Excel from 'exceljs'
import { simpleGit } from 'simple-git'
import { buildSpreadsheetValidationMarkdown } from './render.js'
import { cellValueText, customValidationExports, outputRelativePath, readOrganisationRulesFrom, readUtilsVersion, requireWorkbook, workbookRelativePath } from './catalogue.js'
import { customConstantsFrom, joinSpreadsheetFields, messageCatalogFrom } from './schema-advice.js'
import { patternSamplesFrom } from './patterns.js'
import { assertPublishVariables, publishMarkdown } from './confluence.js'
import { customAllowedValuesFrom } from './custom-values.js'

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(import.meta.dirname, '../..')
const repo = simpleGit(repoRoot)

const removeQuietly = async (task) => {
  try {
    await task()
  } catch {
    // Cleanup must not hide the original failure.
  }
}
const movementRemote = 'git@github.com:DEFRA/waste-movement-backend.git'

const commitOf = (cwd) => simpleGit(cwd).revparse('HEAD')

const checkoutOrganisationTag = async (tag) => {
  try {
    await repo.revparse(['--verify', `refs/tags/${tag}`])
  } catch {
    await repo.fetch(['--no-tags', 'origin', 'tag', tag])
  }
  const orgDir = path.join(tmpdir(), `organisation-backend-${randomUUID()}`)
  await repo.raw(['worktree', 'add', '--detach', orgDir, tag])
  return orgDir
}

const shallowFetchMovementTag = async (tag) => {
  const parent = await mkdtemp(path.join(tmpdir(), 'movement-backend-'))
  const movementDir = path.join(parent, 'repo')
  await simpleGit().clone(movementRemote, movementDir, { '--depth': 1, '--branch': tag })
  return { parent, movementDir }
}

const installUtils = async (version) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'waste-movement-utils-'))
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'spreadsheet-validation-utils',
      private: true,
      type: 'module',
      dependencies: { '@defra/waste-movement-utils': version }
    })
  )
  await execFileAsync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dir })
  return dir
}

const importJoi = async (utilsDir) => {
  const candidates = [path.join(utilsDir, 'node_modules/joi/lib/index.js'), path.join(utilsDir, 'node_modules/@defra/waste-movement-utils/node_modules/joi/lib/index.js')]
  for (const candidate of candidates) {
    try {
      await access(candidate)
    } catch {
      continue
    }
    try {
      const loaded = await import(pathToFileURL(candidate).href)
      return loaded.default ?? loaded
    } catch (cause) {
      throw new Error(`Could not load joi from ${candidate}`, { cause })
    }
  }
  throw new Error('Installed @defra/waste-movement-utils did not include joi')
}

const readTemplateWorkbook = async (workbookPath) => {
  const workbook = new Excel.Workbook()
  await workbook.xlsx.readFile(workbookPath)
  const coversheet = workbook.worksheets[0]
  const templateKey = cellValueText(coversheet.getRow(1).getCell(1).value)
  const cellText = (sheetName, row, column) => {
    const worksheet = workbook.getWorksheet(sheetName)
    if (worksheet == null) {
      throw new Error(`Workbook has no worksheet '${sheetName}'`)
    }
    return cellValueText(worksheet.getRow(row).getCell(column).value)
  }
  return { templateKey, cellText }
}

const main = async () => {
  const { values, positionals } = parseArgs({
    options: { publish: { type: 'boolean', default: false } },
    allowPositionals: true,
    strict: true
  })
  const [organisationTag, movementTag] = positionals
  if (values.publish) {
    assertPublishVariables(process.env)
  }
  if (!organisationTag || !movementTag) {
    throw new Error('Usage: npm run docs:spreadsheet-validation -- <organisation-backend-tag> <movement-backend-tag> [--publish]')
  }

  const workbookPath = path.resolve(repoRoot, workbookRelativePath)
  await requireWorkbook(workbookPath)

  const orgDir = await checkoutOrganisationTag(organisationTag)
  let movementParent = null
  let utilsDir = null
  try {
    const movement = await shallowFetchMovementTag(movementTag)
    movementParent = movement.parent
    const lockfile = JSON.parse(await readFile(path.join(movement.movementDir, 'package-lock.json'), 'utf8'))
    const utilsVersion = readUtilsVersion(lockfile)
    utilsDir = await installUtils(utilsVersion)
    const utilsEntry = pathToFileURL(path.join(utilsDir, 'node_modules/@defra/waste-movement-utils/src/index.js')).href
    const utilsPackage = path.join(utilsDir, 'node_modules/@defra/waste-movement-utils')
    const utils = await import(utilsEntry)
    const sources = {}
    for (const spec of Object.values(customValidationExports)) {
      for (const file of spec.regexFiles ?? []) {
        sources[file] = await readFile(path.join(utilsPackage, file), 'utf8')
      }
    }
    const utilsSources = {}
    for (const folder of ['src/schemas', 'src/constants']) {
      for (const name of await readdir(path.join(utilsPackage, folder))) {
        if (name.endsWith('.js') && !name.endsWith('.test.js')) {
          const relative = `${folder}/${name}`
          utilsSources[relative] = await readFile(path.join(utilsPackage, relative), 'utf8')
        }
      }
    }
    const Joi = await importJoi(utilsDir)
    const { catalogue, parsers } = await readOrganisationRulesFrom(orgDir)
    const { templateKey, cellText } = await readTemplateWorkbook(workbookPath)
    const catalogueEntry = catalogue[templateKey]
    if (catalogueEntry == null) {
      throw new Error(`Unknown template key '${templateKey}'`)
    }
    const createDescribed = utils.receiveMovementRequestSchema.describe()
    const updateDescribed = utils.receiveMovementRequestSchema
      .keys({
        wasteTrackingId: Joi.string().required()
      })
      .describe()
    const fields = joinSpreadsheetFields({
      catalogueEntry,
      cellText,
      createDescribed,
      updateDescribed,
      parsers,
      customConstants: customConstantsFrom(utils, sources),
      messageCatalog: messageCatalogFrom(utils),
      patternSamples: patternSamplesFrom(utils),
      customAllowedValues: customAllowedValuesFrom(utilsSources)
    })
    const markdown = buildSpreadsheetValidationMarkdown({
      templateKey,
      workbookPath: workbookRelativePath,
      organisationTag,
      organisationCommit: await commitOf(orgDir),
      movementTag,
      movementCommit: await commitOf(movement.movementDir),
      utilsVersion,
      fields
    })
    await writeFile(path.join(repoRoot, outputRelativePath), markdown)
    if (values.publish) {
      const published = await publishMarkdown(markdown, process.env)
      console.log(`Published ${published.title} to Confluence as version ${published.version}.`)
    }
  } finally {
    await removeQuietly(() => repo.raw(['worktree', 'remove', '--force', orgDir]))
    await removeQuietly(() => rm(orgDir, { recursive: true, force: true }))
    if (movementParent) {
      await removeQuietly(() => rm(movementParent, { recursive: true, force: true }))
    }
    if (utilsDir) {
      await removeQuietly(() => rm(utilsDir, { recursive: true, force: true }))
    }
  }
}

await main()

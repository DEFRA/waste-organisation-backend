/* Sandboxed spreadsheet parser — runs as a separate, resource-limited child process spawned by spreadsheetSandbox.js.

Args:
argv[2] = path to the input .xlsx
argv[3] = organisationId
argv[4] = uploadType ('create' | 'update')

The parse result is written to fd 3, which should be a pipe, so it doesn't run into log output or a stray output of any sort; logs will be on fd 1.

If an unexpected error occur in parsing, we write something to fd 3 and exit 0; if killed by signal of any sort, we don't write anything, which should be interpreted as 'blew up'.
*/

import fs from 'node:fs'
import { parseExcelFile, workbookToByteArray } from './spreadsheetImport.js'
import { createLogger } from '../common/helpers/logging/logger.js'

const [, , inputPath, organisationId, uploadType] = process.argv

const writeResult = (result) => {
  //3 is fd 3, by contract
  fs.writeFileSync(3, JSON.stringify(result))
}

const run = async () => {
  const logger = createLogger()
  const buffer = await fs.promises.readFile(inputPath)
  const { hasErrors, workbook, movements, rowNumbers, errors } = await parseExcelFile(buffer, organisationId, logger, uploadType)

  /* Serialise the workbook with eventual errors in */
  const workbookBase64 = workbook ? Buffer.from(await workbookToByteArray(workbook, logger)).toString('base64') : null

  writeResult({ hasErrors, errors: errors ?? null, movements: movements ?? null, rowNumbers: rowNumbers ?? null, workbookBase64 })
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    // parse error (not resource breach)
    // TODO Formalise this
    writeResult({ errors: e?.message ?? String(e) })
    process.exit(0)
  })

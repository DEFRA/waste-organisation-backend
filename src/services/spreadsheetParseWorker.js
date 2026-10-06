/* Sandboxed spreadsheet parser — runs as a separate, resource-limited child process spawned by spreadsheetSandbox.js.

Args:
argv[2] = s3 bucket name - contains the spreadsheet
argv[3] = s3 key
argv[4] = reference number
argv[5] = organisationId
argv[6] = uploadType ('create' | 'update')

The parse result is written to fd 3, which should be a pipe, so it doesn't run into log output or a stray output of any sort; logs will be on fd 1.

If an unexpected error occur in parsing, we write something to fd 3 and exit 0; if killed by signal of any sort, we don't write anything, which should be interpreted as 'blew up'.
*/
/* v8 ignore start */
import fs from 'node:fs'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { parseExcelFile, workbookToByteArray } from './spreadsheetImport.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { config } from '../config.js'

const [, , s3Bucket, s3Key, referenceNumber, organisationId, uploadType] = process.argv

const writeResult = (result) => {
  //3 is fd 3, by contract
  fs.writeFileSync(3, JSON.stringify(result)) // NOSONAR
}

// S3 download is done here (not in the parent) , we copy the two S3 functions to keep the process lean.
const constructS3Client = () =>
  new S3Client({
    region: config.get('aws.region'),
    endpoint: config.get('aws.s3Endpoint'),
    forcePathStyle: config.get('aws.forcePathStyle')
  })

const fetchS3Object = async (s3Client, Bucket, Key) => {
  const response = await s3Client.send(new GetObjectCommand({ Bucket, Key, ChecksumMode: config.get('aws.checksumMode') }))
  const chunks = []
  for await (const chunk of await response.Body) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

// TODO: make this unit testable
const run = async () => {
  const logger = createLogger()
  const s3Client = constructS3Client()
  const buffer = await fetchS3Object(s3Client, s3Bucket, s3Key)
  logger.info(`ReferenceNumber: ${referenceNumber} -- Fetching bytes: ${buffer.length}`)
  const { hasErrors, workbook, movements, rowNumbers, errors } = await parseExcelFile(buffer, organisationId, logger, uploadType)

  // Output a base64 serialisation of the workbook object (xlsx bytes, with any error annotations already applied) for the parent to consume.
  const workbookBase64 = workbook ? Buffer.from(await workbookToByteArray(workbook, logger)).toString('base64') : null

  writeResult({ hasErrors, errors: errors ?? null, movements: movements ?? null, rowNumbers: rowNumbers ?? null, workbookBase64 })
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    // An unexpected parse failure (not a resource breach). Reported under its own
    // `parseError` key — distinct from the `errors` validation map of a normal
    // result — so the parent (spreadsheetSandbox) can tell it apart and reject.
    writeResult({ parseError: e?.message ?? String(e) })
    process.exit(0)
  })
/* v8 ignore stop */

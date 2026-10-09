import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Resource limits for a sandboxed parser
const SANDBOX_MAX_HEAP_MB = 1024 // with node --max-old-space-size; heap size, so very approximate. Actual process peaks at ~300MB
const SANDBOX_MAX_FILE_BLOCKS = 102400 // with ulimit -f; 512-byte blocks, so 50MB of disk
export const SANDBOX_MAX_TIME_MS = 300000 // enforced by timed signal on parent (wall clock)

//compute absolute file path of the work file, relative to this file
const parseWorkerPath = fileURLToPath(new URL('./spreadsheetParseWorker.js', import.meta.url))

// Parse the spreadsheet in a separate, resource-limited process.
export const downloadAndParseSpreadsheetInSandbox = async ({ s3Bucket, s3Key, referenceNumber, organisationId, uploadType, traceId, logger, maxTimeMs = SANDBOX_MAX_TIME_MS }) => {
  logger.info(`Parsing spreadsheet in sandbox (limits: ${SANDBOX_MAX_HEAP_MB}MB heap, ${SANDBOX_MAX_FILE_BLOCKS / 2048}MB disk, ${maxTimeMs}ms max runtime)`)
  return await new Promise((resolve, reject) => {
    /* ulimit caps disk writes, --max-old-space-size caps the V8 heap. We use exec so node takes on the process' PID, and the potential SIGKILL to the shell does not leave an orphan; the file descriptors can be inherited, no problem. */
    const command = `ulimit -f ${SANDBOX_MAX_FILE_BLOCKS}; exec node --max-old-space-size=${SANDBOX_MAX_HEAP_MB} "$1" "$2" "$3" "$4" "$5" "$6" "$7"`

    const child = spawn('/bin/sh', ['-c', command, 'sh', parseWorkerPath, s3Bucket, s3Key, referenceNumber, organisationId, uploadType ?? '', traceId ?? ''], {
      stdio: ['ignore', 'inherit', 'inherit', 'pipe'] // fd 3 will be the result, with logs on stdout / fd 1
    })
    let result = ''
    child.stdio[3].on('data', (chunk) => (result += chunk)) // NOSONAR
    const killTimer = setTimeout(() => child.kill('SIGKILL'), maxTimeMs)
    child.on('error', (err) => {
      clearTimeout(killTimer)
      reject(err)
    })
    child.on('exit', (code, signal) => {
      clearTimeout(killTimer)
      // Killed by a resource limit.
      // TODO: distinguish between blowup types
      if (signal || code !== 0 || result === '') {
        return reject(new Error(`Spreadsheet parse exceeded resource limits (signal: ${signal}, code: ${code})`))
      }

      const parsed = JSON.parse(result)
      if (parsed.parseError) {
        return reject(new Error(`Spreadsheet parse failed: ${parsed.parseError}`))
      }
      parsed.workbookBytes = parsed.workbookBase64 ? Buffer.from(parsed.workbookBase64, 'base64') : null
      delete parsed.workbookBase64
      return resolve(parsed)
    })
  })
}

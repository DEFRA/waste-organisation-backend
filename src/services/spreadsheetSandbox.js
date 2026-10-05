import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile, unlink } from 'node:fs/promises'

// Resource limits for a sandboxed parser
const SANDBOX_MAX_HEAP_MB = 256 // with node --max-old-space-size; heap size, so very approximate. Actual process peaks at ~300MB
const SANDBOX_MAX_FILE_BLOCKS = 102400 // with ulimit -f; 512-byte blocks, so 50MB of disk
export const SANDBOX_MAX_TIME_MS = 15000 // enforced by timed signal on parent (wall clock)

//compute absolute file path of the work file, relative to this file
const parseWorkerPath = fileURLToPath(new URL('./spreadsheetParseWorker.js', import.meta.url))

// Parse the spreadsheet in a separate, resource-limited process.
export const parseSpreadsheetInSandbox = async (buffer, organisationId, uploadType, logger) => {
  //write the spreadsheet data into a file as serialisation
  const inputPath = join(tmpdir(), `spreadsheet-${randomUUID()}.xlsx`)
  await writeFile(inputPath, buffer)

  logger.info(
    `Parsing spreadsheet in sandbox (limits: ${SANDBOX_MAX_HEAP_MB}MB heap, ${SANDBOX_MAX_FILE_BLOCKS / 2048}MB disk, ${SANDBOX_MAX_TIME_MS}ms max runtime)`
  )
  try {
    return await new Promise((resolve, reject) => {
      /* ulimit caps disk writes, --max-old-space-size caps the V8 heap. We use exec so node takes on the process' PID, and the potential SIGKILL to the shell does not leave an orphan; the file descriptors can be inherited, no problem. */
      const command = `ulimit -f ${SANDBOX_MAX_FILE_BLOCKS}; exec node --max-old-space-size=${SANDBOX_MAX_HEAP_MB} "$1" "$2" "$3" "$4"`
      const child = spawn('/bin/sh', ['-c', command, 'sh', parseWorkerPath, inputPath, organisationId, uploadType ?? ''], {
        stdio: ['ignore', 'inherit', 'inherit', 'pipe'] // fd 3 will be the result, with logs on stdout / fd 1
      })
      let result = ''
      child.stdio[3].on('data', (chunk) => (result += chunk))
      const killTimer = setTimeout(() => child.kill('SIGKILL'), SANDBOX_MAX_TIME_MS)
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
        resolve(parsed)
      })
    })
  } finally {
    await unlink(inputPath).catch(() => {})
  }
}

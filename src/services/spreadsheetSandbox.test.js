import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

import { spawn } from 'node:child_process'
import { downloadAndParseSpreadsheetInSandbox } from './spreadsheetSandbox.js'

// Override the wall-clock limit for the tests (the production default is 15000ms).
const SANDBOX_MAX_TIME_MS = 2500

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() }

// A stand-in for the spawned ChildProcess: an EventEmitter (for 'exit'/'error')
// with a readable fd-3 stream and a mock kill().
const makeChild = () => {
  const child = new EventEmitter()
  child.stdio = [null, null, null, new EventEmitter()]
  child.kill = vi.fn()
  return child
}

// Flush microtasks (harmless; spawn is actually called synchronously inside the
// Promise executor, so the child/listeners exist as soon as the call returns).
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

// Start a parse, let it reach spawn, and hand back the fake child + promise.
const startParse = async (s3Bucket = 'test-bucket', s3Key = 'test-key', referenceNumber = 'ref-1', org = 'org-123', uploadType = 'create') => {
  const child = makeChild()
  spawn.mockReturnValue(child)
  const promise = downloadAndParseSpreadsheetInSandbox({
    s3Bucket,
    s3Key,
    referenceNumber,
    organisationId: org,
    uploadType,
    logger,
    maxTimeMs: SANDBOX_MAX_TIME_MS
  })
  await settle()
  return { child, promise }
}

const emitResult = (child, result) => child.stdio[3].emit('data', Buffer.from(JSON.stringify(result)))

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('downloadAndParseSpreadsheetInSandbox', () => {
  it('resolves on a clean exit, decoding workbookBase64 to a workbookBytes Buffer', async () => {
    const { child, promise } = await startParse()

    emitResult(child, { hasErrors: false, movements: [{ yourUniqueReference: 'REF1' }], rowNumbers: {}, errors: null, workbookBase64: 'AA==' })
    child.emit('exit', 0, null)

    await expect(promise).resolves.toEqual({
      hasErrors: false,
      movements: [{ yourUniqueReference: 'REF1' }],
      rowNumbers: {},
      errors: null,
      workbookBytes: Buffer.from('AA==', 'base64')
    })
  })

  it('returns workbookBytes: null when the child produced no workbook', async () => {
    const { child, promise } = await startParse()
    emitResult(child, { hasErrors: true, errors: { '7. Waste movement level': [] } })
    child.emit('exit', 0, null)
    await expect(promise).resolves.toEqual({ hasErrors: true, errors: { '7. Waste movement level': [] }, workbookBytes: null })
  })

  it('spawns a resource-limited child with the worker and S3/job args', async () => {
    const { child, promise } = await startParse('bucket-x', 'key-x', 'ref-9', 'org-xyz', 'update')

    expect(spawn).toHaveBeenCalledTimes(1)
    const [cmd, args, opts] = spawn.mock.calls[0]
    expect(cmd).toBe('/bin/sh')
    expect(args[0]).toBe('-c')
    expect(args[1]).toContain('ulimit -f 102400') // 50MB disk cap
    expect(args[1]).toContain('--max-old-space-size=1024') // heap cap
    expect(args[1]).toContain('exec node')
    expect(args[1]).toContain('"$6"') // all six positional args are forwarded to node
    // positional args: $0='sh', $1=worker, $2=bucket, $3=key, $4=referenceNumber, $5=org, $6=uploadType
    expect(args[2]).toBe('sh')
    expect(args[3]).toMatch(/spreadsheetParseWorker\.js$/)
    expect(args[4]).toBe('bucket-x')
    expect(args[5]).toBe('key-x')
    expect(args[6]).toBe('ref-9')
    expect(args[7]).toBe('org-xyz')
    expect(args[8]).toBe('update')
    // fd 3 is a pipe for the result; stdout/stderr inherited, stdin ignored
    expect(opts.stdio).toEqual(['ignore', 'inherit', 'inherit', 'pipe'])

    emitResult(child, { hasErrors: false })
    child.emit('exit', 0, null)
    await promise
  })

  it('passes an empty string when uploadType is undefined', async () => {
    const child = makeChild()
    spawn.mockReturnValue(child)
    const promise = downloadAndParseSpreadsheetInSandbox({
      s3Bucket: 'b',
      s3Key: 'k',
      referenceNumber: 'r',
      organisationId: 'org-1',
      uploadType: undefined,
      logger,
      maxTimeMs: SANDBOX_MAX_TIME_MS
    })
    await settle()

    expect(spawn.mock.calls[0][1][8]).toBe('')

    emitResult(child, { hasErrors: false })
    child.emit('exit', 0, null)
    await promise
  })

  it('rejects when killed by a signal, discarding any result it had written', async () => {
    const { child, promise } = await startParse()
    emitResult(child, { hasErrors: false }) // a (complete) result is still thrown away on a signal kill
    child.emit('exit', null, 'SIGKILL')
    await expect(promise).rejects.toThrow(/exceeded resource limits/)
  })

  it('rejects on a non-zero exit code even when a result was produced', async () => {
    const { child, promise } = await startParse()
    emitResult(child, { hasErrors: false }) // isolates the code check from the empty-result check
    child.emit('exit', 1, null)
    await expect(promise).rejects.toThrow(/exceeded resource limits/)
  })

  it('rejects on a clean exit that produced no result on fd 3', async () => {
    const { child, promise } = await startParse()
    child.emit('exit', 0, null) // no data emitted
    await expect(promise).rejects.toThrow(/exceeded resource limits/)
  })

  it('rejects when the child reports a parseError in its result', async () => {
    const { child, promise } = await startParse()
    emitResult(child, { parseError: 'Cannot parse component codes' })
    child.emit('exit', 0, null)
    await expect(promise).rejects.toThrow(/Spreadsheet parse failed: Cannot parse component codes/)
  })

  it('accumulates fd-3 data arriving in multiple chunks', async () => {
    const { child, promise } = await startParse()
    const json = JSON.stringify({ hasErrors: false, workbookBase64: 'QQ==' })
    const mid = Math.floor(json.length / 2)
    child.stdio[3].emit('data', Buffer.from(json.slice(0, mid)))
    child.stdio[3].emit('data', Buffer.from(json.slice(mid)))
    child.emit('exit', 0, null)
    await expect(promise).resolves.toEqual({ hasErrors: false, workbookBytes: Buffer.from('QQ==', 'base64') })
  })

  it('rejects when spawn emits an error, and clears the kill timer', async () => {
    const { child, promise } = await startParse()
    child.emit('error', new Error('spawn ENOENT'))
    await expect(promise).rejects.toThrow('spawn ENOENT')

    vi.advanceTimersByTime(SANDBOX_MAX_TIME_MS * 2)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('SIGKILLs the child after the wall-clock timeout', async () => {
    const { child, promise } = await startParse()

    vi.advanceTimersByTime(SANDBOX_MAX_TIME_MS)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')

    // A real child would then exit by signal, settling the promise.
    child.emit('exit', null, 'SIGKILL')
    await expect(promise).rejects.toThrow(/exceeded resource limits/)
  })

  it('clears the kill timer on a normal exit (no kill after it returns)', async () => {
    const { child, promise } = await startParse()
    emitResult(child, { hasErrors: false })
    child.emit('exit', 0, null)
    await promise

    vi.advanceTimersByTime(SANDBOX_MAX_TIME_MS * 2)
    expect(child.kill).not.toHaveBeenCalled()
  })
})

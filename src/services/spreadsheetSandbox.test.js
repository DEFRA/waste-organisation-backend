import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
vi.mock('node:fs/promises', () => ({ writeFile: vi.fn(), unlink: vi.fn() }))

import { spawn } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
import { parseSpreadsheetInSandbox, SANDBOX_MAX_TIME_MS } from './spreadsheetSandbox.js'

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() }

// A stand-in for the spawned ChildProcess: an EventEmitter (for 'exit'/'error')
// with a readable fd-3 stream and a mock kill().
const makeChild = () => {
  const child = new EventEmitter()
  child.stdio = [null, null, null, new EventEmitter()]
  child.kill = vi.fn()
  return child
}

// Flush pending microtasks so the awaited writeFile resolves and spawn runs
// (works under fake timers, which only affect timer callbacks).
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

// Start a parse, let it reach spawn, and hand back the fake child + promise.
const startParse = async (buffer = Buffer.from('xlsx'), org = 'org-123', uploadType = 'create') => {
  const child = makeChild()
  spawn.mockReturnValue(child)
  const promise = parseSpreadsheetInSandbox(buffer, org, uploadType, logger)
  await settle()
  return { child, promise }
}

const emitResult = (child, result) => child.stdio[3].emit('data', Buffer.from(JSON.stringify(result)))

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  writeFile.mockResolvedValue(undefined)
  unlink.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('parseSpreadsheetInSandbox', () => {
  it('resolves with the parsed result written by the child on a clean exit', async () => {
    const { child, promise } = await startParse()

    emitResult(child, { hasErrors: false, movements: [{ yourUniqueReference: 'REF1' }], rowNumbers: {}, errors: null, workbookBase64: 'AA==' })
    child.emit('exit', 0, null)

    await expect(promise).resolves.toEqual({
      hasErrors: false,
      movements: [{ yourUniqueReference: 'REF1' }],
      rowNumbers: {},
      errors: null,
      workbookBase64: 'AA=='
    })
  })

  it('writes the buffer to a temp .xlsx and removes it afterwards', async () => {
    const buffer = Buffer.from('spreadsheet-bytes')
    const { child, promise } = await startParse(buffer)

    expect(writeFile).toHaveBeenCalledTimes(1)
    const [inputPath, written] = writeFile.mock.calls[0]
    expect(inputPath).toMatch(/spreadsheet-.*\.xlsx$/)
    expect(written).toBe(buffer)

    emitResult(child, { hasErrors: false })
    child.emit('exit', 0, null)
    await promise

    expect(unlink).toHaveBeenCalledWith(inputPath)
  })

  it('spawns a resource-limited child with the worker, input path and job args', async () => {
    const { child, promise } = await startParse(Buffer.from('x'), 'org-xyz', 'update')

    expect(spawn).toHaveBeenCalledTimes(1)
    const [cmd, args, opts] = spawn.mock.calls[0]
    expect(cmd).toBe('/bin/sh')
    expect(args[0]).toBe('-c')
    expect(args[1]).toContain('ulimit -f 102400') // 50MB disk cap
    expect(args[1]).toContain('--max-old-space-size=256') // heap cap
    expect(args[1]).toContain('exec node')
    // positional args passed to the shell: $0..$4
    expect(args[2]).toBe('sh')
    expect(args[3]).toMatch(/spreadsheetParseWorker\.js$/)
    expect(args[4]).toBe(writeFile.mock.calls[0][0]) // the temp input path
    expect(args[5]).toBe('org-xyz')
    expect(args[6]).toBe('update')
    // fd 3 is a pipe for the result; stdout/stderr inherited, stdin ignored
    expect(opts.stdio).toEqual(['ignore', 'inherit', 'inherit', 'pipe'])

    emitResult(child, { hasErrors: false })
    child.emit('exit', 0, null)
    await promise
  })

  it('passes an empty string when uploadType is undefined', async () => {
    // call directly so startParse's default doesn't mask the undefined
    const child = makeChild()
    spawn.mockReturnValue(child)
    const promise = parseSpreadsheetInSandbox(Buffer.from('x'), 'org-1', undefined, logger)
    await settle()

    expect(spawn.mock.calls[0][1][6]).toBe('')

    emitResult(child, { hasErrors: false })
    child.emit('exit', 0, null)
    await promise
  })

  it('rejects when killed by a signal, discarding any result it had written', async () => {
    const { child, promise } = await startParse()
    emitResult(child, { hasErrors: false }) // a (complete) result is still thrown away on a signal kill
    child.emit('exit', null, 'SIGKILL')
    await expect(promise).rejects.toThrow(/exceeded resource limits/)
    expect(unlink).toHaveBeenCalled() // temp file still cleaned up
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
    await expect(promise).resolves.toEqual({ hasErrors: false, workbookBase64: 'QQ==' })
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

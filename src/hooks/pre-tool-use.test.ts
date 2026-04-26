import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

let tempDir: string

async function importFresh() {
  vi.resetModules()
  vi.doMock('node:os', () => ({ homedir: () => tempDir }))
  return await import('./pre-tool-use.js')
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'claudekeeper-pretool-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('readOutcomePending', () => {
  it('returns null when no file exists', async () => {
    const { readOutcomePending } = await importFresh()
    expect(readOutcomePending()).toBeNull()
  })

  it('returns null when file is empty object', async () => {
    const { readOutcomePending } = await importFresh()
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(resolve(tempDir, '.claudekeeper'), { recursive: true })
    writeFileSync(resolve(tempDir, '.claudekeeper', 'pretool-outcome-pending.json'), '{}')
    expect(readOutcomePending()).toBeNull()
  })

  it('returns null when pending is expired (>5 min)', async () => {
    const { readOutcomePending } = await importFresh()
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(resolve(tempDir, '.claudekeeper'), { recursive: true })
    writeFileSync(
      resolve(tempDir, '.claudekeeper', 'pretool-outcome-pending.json'),
      JSON.stringify({
        command: 'npm run build',
        baseCommand: 'npm run',
        timestamp: Date.now() - 6 * 60 * 1000, // 6 min ago
      })
    )
    expect(readOutcomePending()).toBeNull()
  })

  it('returns pending when within 5 min window', async () => {
    const { readOutcomePending } = await importFresh()
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(resolve(tempDir, '.claudekeeper'), { recursive: true })
    const pending = {
      command: 'npm run build',
      baseCommand: 'npm run',
      timestamp: Date.now() - 60 * 1000, // 1 min ago
      hubEntryIds: ['entry-1', 'entry-2'],
    }
    writeFileSync(
      resolve(tempDir, '.claudekeeper', 'pretool-outcome-pending.json'),
      JSON.stringify(pending)
    )
    const result = readOutcomePending()
    expect(result).not.toBeNull()
    expect(result!.command).toBe('npm run build')
    expect(result!.hubEntryIds).toEqual(['entry-1', 'entry-2'])
  })
})

describe('clearOutcomePending', () => {
  it('clears the pending state', async () => {
    const { readOutcomePending, clearOutcomePending } = await importFresh()
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(resolve(tempDir, '.claudekeeper'), { recursive: true })
    writeFileSync(
      resolve(tempDir, '.claudekeeper', 'pretool-outcome-pending.json'),
      JSON.stringify({
        command: 'npm run build',
        baseCommand: 'npm run',
        timestamp: Date.now(),
      })
    )
    clearOutcomePending()
    expect(readOutcomePending()).toBeNull()
  })
})

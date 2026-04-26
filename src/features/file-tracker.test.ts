import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

let tempDir: string

async function importFresh() {
  vi.resetModules()
  vi.doMock('node:os', () => ({ homedir: () => tempDir }))
  return await import('./file-tracker.js')
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'claudekeeper-ft-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(tempDir, { recursive: true, force: true })
})

function cwd(label: string): string {
  return `${tempDir}/project-${label}`
}

describe('recordFileEdit', () => {
  it('records a file edit', async () => {
    const { recordFileEdit, readFileIndex } = await importFresh()
    const c = cwd('edit1')
    recordFileEdit(c, `${c}/src/app.ts`, 'session-1')
    const index = readFileIndex(c)
    expect(index['src/app.ts'].editCount).toBe(1)
    expect(index['src/app.ts'].sessions).toBe(1)
  })

  it('increments edit count, sessions stays at 1 for same session', async () => {
    const { recordFileEdit, readFileIndex } = await importFresh()
    const c = cwd('edit2')
    recordFileEdit(c, `${c}/src/app.ts`, 'session-1')
    recordFileEdit(c, `${c}/src/app.ts`, 'session-1')
    recordFileEdit(c, `${c}/src/app.ts`, 'session-1')
    const index = readFileIndex(c)
    expect(index['src/app.ts'].editCount).toBe(3)
    expect(index['src/app.ts'].sessions).toBe(1)
  })
})

describe('recordFileRead', () => {
  it('records a file read', async () => {
    const { recordFileRead, readFileIndex } = await importFresh()
    const c = cwd('read1')
    recordFileRead(c, `${c}/config.json`, 'session-1')
    const index = readFileIndex(c)
    const configKey = Object.keys(index).find(k => k.endsWith('config.json'))
    expect(configKey).toBeDefined()
    expect(index[configKey!].readCount).toBe(1)
  })
})

describe('getFileContext', () => {
  it('returns null for files below threshold', async () => {
    const { recordFileEdit, getFileContext } = await importFresh()
    const c = cwd('below')
    recordFileEdit(c, `${c}/src/app.ts`, 'session-1')
    expect(getFileContext(c, `${c}/src/app.ts`)).toBeNull()
  })

  it('returns context for hot files (5+ edits, 3+ sessions)', async () => {
    const { recordFileEdit, readFileIndex, getFileContext } = await importFresh()
    const c = cwd('hot')
    for (let s = 1; s <= 4; s++) {
      for (let e = 0; e < 2; e++) {
        recordFileEdit(c, `${c}/src/hot.ts`, `session-${s}`)
      }
    }
    const index = readFileIndex(c)
    expect(index['src/hot.ts'].editCount).toBe(8)
    expect(index['src/hot.ts'].sessions).toBe(4)

    const ctx = getFileContext(c, `${c}/src/hot.ts`)
    expect(ctx).not.toBeNull()
    expect(ctx).toContain('8 edits')
    expect(ctx).toContain('4 sessions')
  })

  it('returns null for unknown files', async () => {
    const { getFileContext } = await importFresh()
    const c = cwd('unknown')
    expect(getFileContext(c, `${c}/unknown.ts`)).toBeNull()
  })
})

describe('cleanupFileIndex', () => {
  it('removes files not touched in 90 days', async () => {
    const { recordFileEdit, readFileIndex, cleanupFileIndex } = await importFresh()
    const c = cwd('cleanup')
    recordFileEdit(c, `${c}/src/old.ts`, 'session-1')

    const index = readFileIndex(c)
    const oldKey = Object.keys(index).find(k => k.endsWith('old.ts'))!
    const oldDate = new Date()
    oldDate.setDate(oldDate.getDate() - 91)
    index[oldKey].lastEdited = oldDate.toISOString().slice(0, 10)

    const encoded = c.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 100)
    const dir = resolve(tempDir, '.claudekeeper', 'knowledge', encoded)
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, 'files.json'), JSON.stringify(index))

    cleanupFileIndex(c)
    const cleaned = readFileIndex(c)
    const stillExists = Object.keys(cleaned).find(k => k.endsWith('old.ts'))
    expect(stillExists).toBeUndefined()
  })
})

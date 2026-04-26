import { resolve, basename, sep } from 'node:path'
import { homedir } from 'node:os'
import { readdir, stat } from 'node:fs/promises'
import { parseJsonlFile, extractTurns, extractModel, extractSessionContext } from './parser.js'
import { hasResumeBoundary } from '../features/resume-detector.js'
import { SessionStore } from './store.js'

export interface WatcherOptions {
  projectsDir?: string
  projectPath?: string
}

export class SessionWatcher {
  private store: SessionStore
  private projectsDir: string
  private projectPath: string | null

  constructor(store: SessionStore, options: WatcherOptions = {}) {
    this.store = store
    this.projectsDir = resolveHome(options.projectsDir || '~/.claude/projects')
    this.projectPath = options.projectPath || null
  }

  getStore(): SessionStore {
    return this.store
  }

  async scanAll(): Promise<void> {
    const dir = this.projectPath
      ? resolve(this.projectsDir, encodeProjectPath(this.projectPath))
      : this.projectsDir

    try {
      await this.scanDirectory(dir)
    } catch {
      // Directory may not exist yet
    }
  }

  private async scanDirectory(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = resolve(dir, entry.name)
        if (entry.isDirectory()) {
          await this.scanDirectory(fullPath)
        } else if (entry.name.endsWith('.jsonl')) {
          await this.processFile(fullPath)
        }
      }
    } catch {
      // Ignore errors from missing directories
    }
  }

  private async processFile(filePath: string): Promise<void> {
    try {
      const records = await parseJsonlFile(filePath)
      this.updateStore(filePath, records)
    } catch {
      // Ignore corrupt or in-progress files
    }
  }

  private updateStore(filePath: string, records: Parameters<typeof extractTurns>[0]): void {
    const sessionId = extractSessionId(filePath)
    const projectPath = extractProjectPath(filePath, this.projectsDir)
    const turns = extractTurns(records)
    const model = extractModel(records)
    const context = extractSessionContext(records)
    const isResumed = hasResumeBoundary(records)

    if (turns.length > 0) {
      this.store.update(sessionId, filePath, projectPath, turns, model, context, isResumed)
    }
  }
}

export function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function extractSessionId(filePath: string): string {
  const filename = basename(filePath)
  return filename.replace('.jsonl', '')
}

function extractProjectPath(filePath: string, projectsDir: string): string {
  const relative = filePath
    .replace(projectsDir + sep, '')
    .replace(projectsDir + '/', '')
  const parts = relative.split(sep)
  return parts[0] || 'unknown'
}

function resolveHome(filepath: string): string {
  if (filepath.startsWith('~/')) {
    return resolve(homedir(), filepath.slice(2))
  }
  return filepath
}

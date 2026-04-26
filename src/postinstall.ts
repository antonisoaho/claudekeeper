/**
 * Postinstall script — auto-registers any MISSING hooks on npm upgrade.
 *
 * Only runs if the user has already run `claudekeeper install` (at least one
 * claudekeeper hook exists in settings.json). This respects audit-only users
 * who intentionally skip hook registration.
 *
 * Silent on failure (|| true in package.json).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

const SETTINGS_PATH = resolve(homedir(), '.claude/settings.json')
const CLAUDEKEEPER_MARKER = 'claudekeeper hook'

const REQUIRED_HOOKS: Record<string, string> = {
  UserPromptSubmit: 'claudekeeper hook user-prompt-submit',
  PreCompact: 'claudekeeper hook pre-compact',
  PostCompact: 'claudekeeper hook post-compact',
  SessionStart: 'claudekeeper hook session-start',
  Stop: 'claudekeeper hook stop',
  PostToolUse: 'claudekeeper hook post-tool-use',
  PreToolUse: 'claudekeeper hook pre-tool-use',
}

try {
  // Only run if Claude Code is installed
  if (!existsSync(resolve(homedir(), '.claude'))) {
    process.exit(0)
  }

  // Read existing settings
  let settings: Record<string, unknown> = {}
  try {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
  } catch {
    // No settings file — user hasn't set up Claude Code yet
    process.exit(0)
  }

  const hooks = settings.hooks as Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>> | undefined
  if (!hooks) {
    // No hooks at all — user is in audit-only mode or hasn't installed
    process.exit(0)
  }

  // Check if at least one claudekeeper hook exists (user ran `claudekeeper install` before)
  const hasClaudekeeper = Object.values(hooks).some(configs =>
    configs.some(config => config.hooks?.some(h => h.command?.includes(CLAUDEKEEPER_MARKER)))
  )

  if (!hasClaudekeeper) {
    // No claudekeeper hooks — respect audit-only mode
    process.exit(0)
  }

  // User has claudekeeper hooks — check for missing ones and add them
  let added = 0
  for (const [eventName, command] of Object.entries(REQUIRED_HOOKS)) {
    if (!hooks[eventName]) {
      hooks[eventName] = []
    }

    const alreadyInstalled = hooks[eventName].some(config =>
      config.hooks?.some(h => h.command?.includes(CLAUDEKEEPER_MARKER))
    )

    if (!alreadyInstalled) {
      hooks[eventName].push({
        matcher: '',
        hooks: [{ type: 'command', command }],
      })
      added++
    }
  }

  if (added > 0) {
    settings.hooks = hooks
    mkdirSync(resolve(homedir(), '.claude'), { recursive: true })
    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n')
    console.log(`claudekeeper: registered ${added} new hook(s) in ~/.claude/settings.json`)
  }
} catch {
  // Silent failure — don't break npm install
}

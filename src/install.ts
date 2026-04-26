import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const DEFAULT_CLAUDE_DIR = resolve(homedir(), '.claude')

function settingsPath(claudeDir?: string): string {
  return resolve(claudeDir ?? DEFAULT_CLAUDE_DIR, 'settings.json')
}

function skillDir(claudeDir?: string): string {
  return resolve(claudeDir ?? DEFAULT_CLAUDE_DIR, 'skills/save-skill')
}

interface ClaudeSettings {
  hooks?: Record<string, HookEventConfig[]>
  [key: string]: unknown
}

interface HookEventConfig {
  matcher: string
  hooks: HookCommand[]
}

interface HookCommand {
  type: 'command'
  command: string
}

// Detect if running via npx — if so, hooks need the npx prefix
function getHookCommand(subcommand: string): string {
  const isNpx = process.argv[1]?.includes('_npx') || process.env.npm_execpath?.includes('npx')
  if (isNpx) {
    return `npx -y @antonisoaho/claudekeeper hook ${subcommand}`
  }
  return `claudekeeper hook ${subcommand}`
}

const CLAUDEKEEPER_HOOKS: Record<string, HookEventConfig> = {
  UserPromptSubmit: {
    matcher: '',
    hooks: [{ type: 'command', command: getHookCommand('user-prompt-submit') }],
  },
  PreToolUse: {
    matcher: '',
    hooks: [{ type: 'command', command: getHookCommand('pre-tool-use') }],
  },
  PostToolUse: {
    matcher: '',
    hooks: [{ type: 'command', command: getHookCommand('post-tool-use') }],
  },
  PreCompact: {
    matcher: '',
    hooks: [{ type: 'command', command: getHookCommand('pre-compact') }],
  },
  PostCompact: {
    matcher: '',
    hooks: [{ type: 'command', command: getHookCommand('post-compact') }],
  },
  SessionStart: {
    matcher: '',
    hooks: [{ type: 'command', command: getHookCommand('session-start') }],
  },
  Stop: {
    matcher: '',
    hooks: [{ type: 'command', command: getHookCommand('stop') }],
  },
}

const CLAUDEKEEPER_MARKER = 'claudekeeper hook'

/**
 * Install claudekeeper hooks into ~/.claude/settings.json.
 * Merges non-destructively — preserves existing hooks.
 */
export async function installHooks(claudeDir?: string): Promise<string[]> {
  const settings = await readSettings(claudeDir)
  const messages: string[] = []

  if (!settings.hooks) {
    settings.hooks = {}
  }

  for (const [eventName, hookConfig] of Object.entries(CLAUDEKEEPER_HOOKS)) {
    if (!settings.hooks[eventName]) {
      settings.hooks[eventName] = []
    }

    const existingHooks = settings.hooks[eventName]

    // Check if claudekeeper hook already exists
    const alreadyInstalled = existingHooks.some((config) =>
      config.hooks.some((h) => h.command.includes(CLAUDEKEEPER_MARKER))
    )

    if (alreadyInstalled) {
      messages.push(`${eventName}: already installed (skipped)`)
      continue
    }

    // Check for potential conflicts
    const conflicting = existingHooks.filter(
      (config) =>
        config.matcher === hookConfig.matcher &&
        !config.hooks.some((h) => h.command.includes(CLAUDEKEEPER_MARKER))
    )

    if (conflicting.length > 0) {
      messages.push(
        `${eventName}: ⚠ existing hook with same matcher "${hookConfig.matcher}" found — adding claudekeeper alongside it`
      )
    }

    existingHooks.push(hookConfig)
    messages.push(`${eventName}: ✓ installed`)
  }

  await writeSettings(settings, claudeDir)
  messages.push(`\nSettings written to ${settingsPath(claudeDir)}`)

  // Install skills
  const skillMessages = await installSaveSkill(claudeDir)
  messages.push(...skillMessages)
  const continueMessages = await installContinueSkill(claudeDir)
  messages.push(...continueMessages)

  // Write config if not present
  const { writeConfigIfMissing } = await import('./config.js')
  writeConfigIfMissing()

  // Auto-calibrate from session history
  const { calibrate } = await import('./features/calibration.js')
  const cal = calibrate()
  if (cal.confident) {
    messages.push(`Session rotation: ✓ calibrated — blocks at ${cal.wasteThreshold}x waste, ${cal.minTurns}+ turns (from ${cal.sessionsAnalyzed} sessions)`)
  } else {
    messages.push(`Session rotation: ✓ enabled — using conservative 10x threshold (will auto-calibrate after more sessions)`)
  }

  return messages
}

/**
 * Install the /save-skill skill to the user's personal skills directory.
 */
async function installSaveSkill(claudeDir?: string): Promise<string[]> {
  const messages: string[] = []
  const dir = skillDir(claudeDir)
  const skillPath = resolve(dir, 'SKILL.md')

  try {
    // Check if already installed
    try {
      await access(skillPath)
      messages.push('/save-skill: already installed (skipped)')
      return messages
    } catch {
      // Not installed yet
    }

    await mkdir(dir, { recursive: true })

    // Find the bundled SKILL.md — it's in the package's skills/ directory
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const bundledSkill = resolve(__dirname, '..', 'src', 'skills', 'save-skill', 'SKILL.md')

    // Try bundled location first, fall back to writing inline
    try {
      await access(bundledSkill)
      await copyFile(bundledSkill, skillPath)
    } catch {
      // Bundled file not found (running from dist/) — write it directly
      const skillContent = SAVE_SKILL_CONTENT
      await writeFile(skillPath, skillContent)
    }

    const displayDir = dir.replace(homedir(), '~')
    messages.push(`/save-skill: ✓ installed to ${displayDir}/`)
  } catch (err) {
    messages.push(`/save-skill: ⚠ failed to install — ${err}`)
  }

  return messages
}

const SAVE_SKILL_CONTENT = `---
name: save-skill
description: Save what we just did as a reusable skill. Use at the end of a session to capture a workflow, technique, or process that you want to repeat.
disable-model-invocation: true
---

The user wants to save what was done in this session as a reusable Claude Code skill.

## Steps

1. **Review the session**: Look at what was accomplished — the tools used, files modified, commands run, and the overall workflow.

2. **Identify the reusable pattern**: What was the core workflow or technique? Strip away project-specific details and extract the generalizable process.

3. **Ask the user**:
   - "What should this skill be called?" (suggest a name based on what was done)
   - "Should this be a project skill (.claude/skills/) or a personal skill (~/.claude/skills/)?"
   - "Should only you be able to invoke it, or should Claude use it automatically when relevant?"

4. **Create the skill**: Write the SKILL.md file with:
   - YAML frontmatter: name, description, and \\\`disable-model-invocation: true\\\` if user-only
   - Clear step-by-step instructions based on what was done
   - Use \\\`$ARGUMENTS\\\` for any variable parts (file names, branch names, etc.)
   - Keep it under 500 lines — move detailed reference to supporting files if needed

5. **Verify**: Show the user the created skill and explain how to invoke it with /skill-name.

## Important

- Don't include project-specific file paths — use patterns like "src/routes/" not absolute paths
- Include any commands that should be run (test, lint, build)
- If the workflow has multiple variants, use $ARGUMENTS to parameterize
`

/**
 * Install the /claudekeeper-continue skill.
 */
async function installContinueSkill(claudeDir?: string): Promise<string[]> {
  const messages: string[] = []
  const dir = resolve(claudeDir ?? DEFAULT_CLAUDE_DIR, 'skills/claudekeeper-continue')
  const skillPath = resolve(dir, 'SKILL.md')

  try {
    try {
      await access(skillPath)
      messages.push('/claudekeeper-continue: already installed (skipped)')
      return messages
    } catch {}

    await mkdir(dir, { recursive: true })
    await writeFile(skillPath, CONTINUE_SKILL_CONTENT)

    const displayDir = dir.replace(homedir(), '~')
    messages.push(`/claudekeeper-continue: ✓ installed to ${displayDir}/`)
  } catch (err) {
    messages.push(`/claudekeeper-continue: ⚠ failed to install — ${err}`)
  }

  return messages
}

const CONTINUE_SKILL_CONTENT = `---
name: claudekeeper-continue
description: Continue from a previous session. Reads the most recent claudekeeper handoff and resumes work from where the last session left off.
---

The user wants to continue from a previous session. Read the most recent handoff and resume.

## Steps

1. **Find the handoff**: Look in ~/.claudekeeper/sessions/ for the most recent .md file. You can list the directory and read the newest file.

2. **Read the handoff**: Read the full handoff file to understand:
   - What was being worked on (TASK)
   - What was completed (COMPLETED)
   - What was in progress (IN_PROGRESS)
   - What approaches failed (FAILED_APPROACHES)
   - Key decisions and context (DECISIONS, USER_PREFERENCES)
   - Any blockers or gotchas

3. **Brief the user**: Show a short summary of where things left off:
   - "Continuing from session saved [time ago]"
   - What was done, what remains
   - Any blockers or decisions needed

4. **Resume work**: Pick up from where the previous session left off. If there are IN_PROGRESS items, continue those first. Avoid repeating FAILED_APPROACHES.

## Important

- If no handoff files exist, tell the user: "No recent sessions found. What would you like to work on?"
- If multiple handoff files exist, use the most recent one unless the user specifies otherwise
- Do NOT ask the user to copy-paste anything — read the files directly
`

/**
 * Remove claudekeeper hooks from ~/.claude/settings.json.
 */
export async function uninstallHooks(claudeDir?: string): Promise<string[]> {
  const settings = await readSettings(claudeDir)
  const messages: string[] = []

  if (!settings.hooks) {
    messages.push('No hooks configured — nothing to remove')
    return messages
  }

  for (const eventName of Object.keys(settings.hooks)) {
    const before = settings.hooks[eventName].length

    settings.hooks[eventName] = settings.hooks[eventName].filter(
      (config) =>
        !config.hooks.some((h) => h.command.includes(CLAUDEKEEPER_MARKER))
    )

    const removed = before - settings.hooks[eventName].length
    if (removed > 0) {
      messages.push(`${eventName}: ✓ removed ${removed} claudekeeper hook(s)`)
    }

    // Clean up empty arrays
    if (settings.hooks[eventName].length === 0) {
      delete settings.hooks[eventName]
    }
  }

  // Clean up empty hooks object
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks
  }

  await writeSettings(settings, claudeDir)
  messages.push(`\nSettings written to ${settingsPath(claudeDir)}`)

  // Remove skills
  const { rm } = await import('node:fs/promises')
  for (const name of ['save-skill', 'claudekeeper-continue']) {
    const dir = resolve(claudeDir ?? DEFAULT_CLAUDE_DIR, 'skills', name)
    try {
      await access(resolve(dir, 'SKILL.md'))
      await rm(dir, { recursive: true })
      messages.push(`/${name}: ✓ removed`)
    } catch {}
  }

  return messages
}

async function readSettings(claudeDir?: string): Promise<ClaudeSettings> {
  try {
    const content = await readFile(settingsPath(claudeDir), 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

async function writeSettings(settings: ClaudeSettings, claudeDir?: string): Promise<void> {
  const p = settingsPath(claudeDir)
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(settings, null, 2) + '\n')
}

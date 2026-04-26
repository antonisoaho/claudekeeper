# claudekeeper

**Stop Claude Code from burning through your quota in 20 minutes.**

---

## The problem

Every turn in a Claude Code session re-sends your entire conversation history to the API. A fresh session sends ~20k tokens per turn. A 200-turn session sends ~200k per turn. **Same work, 10x more quota.**

```
Turn    1: ██ 20k tokens
Turn   50: ██████████ 100k tokens
Turn  200: ████████████████████ 200k tokens
```

This is why your session limit gets hit fast. Sessions grow linearly and nobody tells you to start fresh.

## The solution

claudekeeper monitors session size, **blocks Claude when you're wasting quota**, saves your progress, and auto-rotates to a fresh session — no manual steps.

```bash
claudekeeper run
```

That's your daily driver. It wraps `claude` and handles everything:

1. You work normally
2. Waste factor hits threshold → session blocked → handoff saved
3. Fresh session starts automatically with context injected
4. Claude continues where you left off
5. Repeat (up to 10 rotations by default)

## Install

```bash
npm install -g @antonisoaho/claudekeeper
claudekeeper install
```

`claudekeeper install` registers hooks into `~/.claude/settings.json`, installs skills (`/save-skill`, `/claudekeeper-continue`), writes default config, and auto-calibrates the rotation threshold from your session history.

Requires Node.js 20+.

## How to continue a session

Three ways, depending on where you are:

| Method | When to use |
|---|---|
| `claudekeeper run` | Best. Auto-rotates and continues automatically |
| `claudekeeper continue` | From terminal. Spawns fresh `claude` with handoff injected |
| `/claudekeeper-continue` | From within Claude Code. Reads handoff in current session |

All three read from `~/.claudekeeper/sessions/` — no copy-pasting paths.

## How it works

claudekeeper registers 7 hooks into Claude Code:

### `UserPromptSubmit` — blocks before tokens are wasted

Before Claude processes your prompt, checks the waste factor. If the session is burning too much quota, it blocks with exit code 2, saves context, and tells you to start fresh.

Also detects "continue" prompts ("continue", "resume", "pick up where I left off") and seamlessly injects the most recent handoff as context — no blocking, no copy-paste.

```
Waste factor = current tokens/turn ÷ baseline tokens/turn

  1x = efficient (fresh session)
  5x = growing
 10x = blocked — start fresh
```

The threshold auto-calibrates from your session history via `claudekeeper calibrate`.

### `PostToolUse` — blocks during autonomous work + compresses output

When Claude works autonomously, there's no user prompt to intercept. PostToolUse checks waste factor after each tool call and blocks if too high.

Also handles:
- **Bash output compression** — large command outputs are compressed before hitting Claude's context
- **Error tracking** — records command failures and successful fixes to the project's error index
- **File tracking** — records which files are edited/read across sessions
- **Cache degradation detection** — warns when prompt cache breaks down
- **Token spike detection** — flags abnormal token consumption
- **Resume anomaly detection** — catches issues from session resumes
- **Known buggy version detection** — warns about Claude Code 2.1.69–2.1.89 (broken prompt cache)

### `SessionStart` — injects previous session context

On every new session, reads saved handoff files and injects them into Claude's context. If a handoff exists, Claude presents the choice: continue or start fresh. Also checks recent session history for health issues (cache degradation, loop patterns) and prunes stale state files.

### `PreCompact` / `PostCompact` — saves context around compaction

PreCompact saves a fallback before compaction. PostCompact captures Claude's own LLM summary merged with mechanically extracted data (files, commits, commands).

### `Stop` — blocks infinite loops

When Claude repeats the same tool call 3+ times with identical input/output, Stop blocks it and saves session state.

### `PreToolUse` — prevents known errors

Before Claude runs a Bash command, checks the project's error index for previous failures. If a known fix exists, injects it as context so Claude can avoid repeating the same mistake.

```
[claudekeeper]: `npm run build` has failed 5 times on this project.
Last error: Module not found: Cannot resolve @/lib/db
Known fix: `npx drizzle-kit push && npm run build`
```

## Session handoff format

When claudekeeper blocks a session, it tells Claude to write a structured handoff:

```
TASK: (what you were working on)
COMPLETED: (what's done)
IN_PROGRESS: (what's partially done, with file paths)
FAILED_APPROACHES: (what was tried and didn't work, and WHY)
DECISIONS: (choices made and why)
USER_PREFERENCES: (what the user asked for or rejected)
BLOCKERS: (unresolved issues)
```

This is merged with mechanical data extracted from the JSONL transcript (files modified, git commits, commands, test results). Together they give the next session the best starting point.

Each handoff is saved as a timestamped file under `~/.claudekeeper/sessions/<project>/`. Files older than 24h are cleaned up automatically.

## Commands

| Command | Description |
|---|---|
| `claudekeeper run` | Run claude with auto-rotation (recommended daily driver) |
| `claudekeeper continue` | Start fresh claude with handoff injected |
| `claudekeeper install` | Register hooks + skills + config + calibrate |
| `claudekeeper uninstall` | Remove hooks and skills |
| `claudekeeper status` | Quick health check (supports `--json`) |
| `claudekeeper report` | Quota usage report — where your tokens went |
| `claudekeeper time` | Token usage by hour of day |
| `claudekeeper sessions` | Per-session breakdown with spike detection |
| `claudekeeper activity` | Recent actions log (warnings, blocks, loops) |
| `claudekeeper stats` | Historical usage analysis with cost estimates |
| `claudekeeper doctor` | Scan for cache degradation |
| `claudekeeper calibrate` | Auto-calibrate rotation threshold from history |
| `claudekeeper knowledge` | Show accumulated errors and file activity |
| `claudekeeper check-memory` | Audit CLAUDE.md token footprint |
| `claudekeeper share` | Copy-pasteable usage summary |

Most commands support `--json` for machine-readable output and `-p, --project <path>` for project filtering.

## Configuration

Everything works out of the box. Config at `~/.claudekeeper/config.json` (created automatically on install):

```json
{
  "rotation": {
    "enabled": true,
    "writeToClaudeMd": true,
    "tokensPerTurnThreshold": 100000,
    "minTurns": 30
  },
  "alerts": {
    "cacheBugThreshold": 3,
    "loopDetectionThreshold": 3,
    "claudeMdTokenWarning": 4000,
    "desktopNotifications": true
  },
  "bashFilter": {
    "enabled": true,
    "maxOutputChars": 2000,
    "preservePatterns": ["error", "warn", "fail", "exception"],
    "noisePatterns": ["npm warn", "added \\d+ packages", "\\[=+"]
  },
  "watch": {
    "projectsDir": "~/.claude/projects",
    "pollInterval": 1000
  }
}
```

## Development

```bash
git clone https://github.com/antonisoaho/claudekeeper.git
cd claudekeeper
npm install
npm test
npm run build
npm link  # links local build as global command
```

## License

MIT

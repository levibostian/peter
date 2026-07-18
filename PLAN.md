# PR Updater v2 — Plan

Interactive CLI that walks through updating PRs one by one, using `pi` agent
sessions (non-interactive, `--mode json`) for each user-configured command.

## Overview

```
Run CLI
  │
  ├─ [auto] Fetch PRs via gh CLI
  ├─ [auto] Build ordered branch list (topological sort for stacks)
  │
  └─ [interactive] Per-branch loop:
      ├─ git checkout branch
      ├─ Fetch fresh PR status (checks, conflicts, reviews, behind-base)
      ├─ Print status + command menu (via sh-style)
      ├─ User picks command → spawn pi --mode json "<prompt>"
      │    └─ blocking: show spinner, print session ID when done
      ├─ User picks "next" → continue next branch
      └─ Loop till all branches done
```

## Boundary

CLI lives in this repo (`pr-updater-v2`). Run it from any repo you want to
update PRs in — it operates on the current working directory's git state.

Never perform git commits or push unless from one of the user-configured commands.

## Phase 1: Non-customizable (auto)

### 1a — Fetch PRs

```
gh pr list --json number,headRefName,baseRefName,headRefOid,statusCheckRollup,reviews,mergeable
```

Parse JSON, build a PR map keyed by head branch name.

Fields needed:
- `headRefName` — the branch
- `baseRefName` — detect stacks (base ≠ default branch)
- `statusCheckRollup` — check status (pass/fail/pending)
- `reviews` — review state (APPROVED/CHANGES_REQUESTED/COMMENTED/PENDING)
- `mergeable` — MERGEABLE/CONFLICTING/UNKNOWN
- `headRefOid` — for behind-base detection

### 1b — Detect default branch

```
gh repo view --json defaultBranch
```

### 1c — Build ordered branch list (topological sort)

Build a graph from PR parent-child relationships. A PR's parent is any other
PR whose `headRefName` matches this PR's `baseRefName`. Apply Kahn's
algorithm:

1. For each PR where `baseRefName !== defaultBranch` and its `baseRefName`
   matches another PR's `headRefName`: create edge parent → child.
2. Queue all PRs with in-degree 0 (roots: no stack parent in our list, or
   base is default branch).
3. Process queue: pop, append to ordered list, decrement children's in-degree,
   enqueue any child that reaches 0.

**Handles**: chains (A→B→C), forks (B→A, C→A), mixed (stacked + independent).
**Skips**: diamonds, cycles (degrade to arbitrary order for remaining nodes).

Result: one flat list of branch names in update order.

## Phase 2: Interactive (per-branch)

For each branch in the ordered list:

### 2a — Setup

1. `git checkout <branch>` — if fail, print error + skip to next branch
2. `gh pr view <number> --json statusCheckRollup,mergeable,reviews,baseRefName,headRefOid,url`

### 2b — Status display (via sh-style)

```
========================================================================
                  PR #42 — feat/add-auth (2/5)
========================================================================

NOTE: status checks, merge status, behind-base, reviews.

ENV:
  checks:  ● unit-tests  ✗ build
  merge:   ● clean
  behind:  4 commits behind main
  review:  ⚠ 1 pending
  diffs:   https://github.com/.../files

------------------------------------------------------------------------
Commands
------------------------------------------------------------------------

  1  Run tests & fix all errors
  2  Run build & fix all errors
  3  Merge base & resolve conflicts
  c  Next branch
  q  Quit
```

Data sources:
- **CI checks**: `gh pr view <N> --json statusCheckRollup` → name/state
- **Merge conflicts**: `gh pr view <N> --json mergeable` → MERGEABLE/CONFLICTING
- **Behind base**: `gh pr view <N> --json baseRefName,headRefOid` → compare OID against base
- **Reviews**: `gh pr view <N> --json reviews` → latest state per reviewer
- **PR diffs link**: `gh pr view <N> --json url` → open files tab

### 2c — Menu

User picks:
- **c** — move to next branch
- **q** — Quit entirely
- **1..N** — Run a user-configured command

### 2d — Running a command (blocking)

1. Spawn `pi --mode json "<prompt>"`
2. CLI shows a spinner while pi runs
3. On completion, print session ID: `✓ Done. Session: <id>`
4. Return to status display + menu for this branch

Blocking per command — no concurrent spawning. User can queue one command,
wait for it to finish, then pick another.

## Phase 3: Configuration

Config file (YAML). Reads from repo root `.pr-updater.yaml`, falls back to
`~/.pr-updater.yaml`.

```yaml
commands:
  - label: Run tests & fix all errors
    prompt: |
      Run the test suite. Fix every failing test. Do not change anything
      else.

  - label: Run build & fix all errors
    prompt: |
      Run the build command. Fix every build error. Do not change anything
      else.

  - label: Merge base branch & resolve conflicts
    prompt: |
      Merge the base branch into this branch and resolve all merge
      conflicts.

pi:
  provider: anthropic
  model: sonnet           # optional — pi defaults to provider's best
  thinking: medium        # off | minimal | low | medium | high | xhigh | max
```

- Commands are positional (index in array = menu key).
- **Zero built-in commands.** All commands come from config.
- `pi.provider` is required. `pi.model` and `pi.thinking` are optional.

## Implementation: Deno

### Dependencies

| Package | Use |
|---------|-----|
| `jsr:@std/yaml` | Parse `.pr-updater.yaml` config |
| `jsr:@levibostian/sh-style` | UI output (status, menu, spinner) |
| `jsr:@levibostian/mock-a-bin` | *dev* — mock `gh`/`pi`/`git` in tests |

### File structure

```
pr-updater-v2/
├── main.ts             — entry point, loop orchestrator
├── gh.ts               — gh CLI wrapper (fetch PRs, status checks)
├── order.ts            — topological sort (branch ordering)
├── config.ts           — YAML config loading & validation
├── pi.ts               — pi --mode json spawner + session ID capture
├── types.ts            — shared types
├── config.test.ts      — config loading tests (temp files)
├── gh.test.ts          — gh wrapper tests (mock-a-bin)
├── order.test.ts       — topological sort tests (pure fn)
├── pi.test.ts          — pi spawner tests (mock-a-bin)
├── main.test.ts        — integration tests for the full loop
├── deno.json
└── .pr-updater.yaml    — example config
```

### Test approach

- **Seams**: `gh.ts`, `pi.ts`, `config.ts`, `order.ts` — each has a focused
  test file.
- **Mocking at system boundary**: use `mock-a-bin` to replace `gh`/`pi`/`git`
  binaries in `$PATH` for `gh.test.ts`, `pi.test.ts`, `main.test.ts`.
- **Pure logic**: `order.test.ts` tests topological sort with no mocking
  needed.
- **Config**: `config.test.ts` tests with real YAML files in temp dirs.
- **Integration**: `main.test.ts` tests the full loop with mocked binaries.

## Edge cases

| Situation | Behavior |
|-----------|----------|
| No open PRs | Print "No open PRs" and exit |
| Branch doesn't exist locally | Print error, skip to next branch |
| No commands configured | Show "Next" and "Quit" only |
| gh not authenticated | Print error, exit |
| Network error during fetch | Don't handle |
| `pi` not installed | Print error, exit |
| User presses Ctrl+C | Exit instantly |
| Single PR with no stacks | Process it, done |
| Cycle in stacked branches (A→B→A) | Don't handle |
| YAML parse error | Print error, exit |
| `pi --mode json` session fails | Print warning, return to menu |
| git checkout fails | Print error, skip branch |
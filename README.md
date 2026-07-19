# PR Updater v2

Ship PRs faster. One agent session per fix, one branch at a time.

PR Updater v2 is an interactive CLI that walks through your open GitHub PRs
and runs [`pi`](https://github.com/earendil-works/pi-coding-agent) agent
sessions to fix them. Think of it as a semi-automated PR workflow: the tool
handles the context switching and status checks; you decide what to fix and
when.

## Why

Updating a stack of PRs is repetitive:

- Checkout branch → run tests → see failures → fix → push → next branch
- Check status checks, resolve conflicts, merge base, repeat
- Keep track of which branches depend on which

This tool automates the mechanical parts. For each PR it:

1. Checks out the right branch (including worktrees)
2. Shows status checks, merge conflicts, reviews, and behind-base count
3. Presents a menu of commands you configure — each one spawns a `pi` agent
   session with a prompt you write
4. Streams the agent's progress so you can watch it work
5. Records the session ID so you can review what happened

## Features

- **Stacked PR support** — topological sort so parent branches update before
  children. Handles chains (A→B→C), forks (B from A, C from A), and mixed
  stacks.
- **Worktree-aware** — detects if a branch is checked out in another
  worktree and switches to it.
- **Zero built-in commands** — every command comes from your config. You
  define the prompts (`"Run tests and fix every failure"`, `"Merge base
  branch and resolve conflicts"`, etc.).
- **Live agent progress** — see tool calls (bash, read, edit, write) stream
  in real time as pi works.
- **Session tracking** — each agent run prints a session ID for later review.
- **Post-checkout hooks** — run shell commands automatically after each
  checkout. Configure things like `npm install` or `make build` so your
  branch is ready to work on immediately.

## Prerequisites

- [Deno](https://deno.com/)
- [GitHub CLI (`gh`)](https://cli.github.com/) — authenticated
- [`pi`](https://github.com/earendil-works/pi-coding-agent) — on PATH

## Quick start

```bash
# 1. Create a config file in your repo
cat > .pr-updater.yaml << 'EOF'
commands:
  - label: Build & test
    prompt: |
      Run the compile/build & test suite. Fix every failing test and build
      error. Do not stop until the build compiles and test suite both pass.
      Do not change anything else.
  - label: Merge base & resolve conflicts
    prompt: |
      Merge the base branch into this branch and resolve all merge
      conflicts.

pi:
  provider: openrouter
  model: deepseek/deepseek-v4-flash
  thinking: medium
EOF

# 2. Run
deno task start
```

## Usage

Run `deno task start` from any git repo that has open PRs. The tool:

1. **Fetches** all open PRs and orders them (parents before children for
   stacked branches).
2. **For each branch** checks it out, fetches current status, and shows a
   status panel:

```
========================================================================
         PR #42 — feat/add-auth (2/5)
========================================================================

checks:
  ✓ unit-tests
  ✗ build
merge:   ● clean
behind:  4 commits behind main
review:  ✗ changes requested
diffs:   https://github.com/org/repo/pull/42/files

------------------------------------------------------------------------
Branches
------------------------------------------------------------------------
  → feat/add-auth
    feat/add-login
    feat/add-dashboard

------------------------------------------------------------------------
Commands
------------------------------------------------------------------------
  1  Build & test
  2  Merge base & resolve conflicts
  c  Next branch
  q  Quit
```

3. **Pick a command** (`1`, `2`, etc.) to spawn a `pi` agent session. The
   tool shows a live feed of the agent's tool calls and captures the session
   ID.
4. **`c`** moves to the next branch. **`q`** exits.

## Configuration

Config lives in `.pr-updater.yaml` (repo root) or `~/.pr-updater.yaml`.

| Field | Required | Description |
|-------|----------|-------------|
| `commands[].label` | yes | Menu label shown in the status panel |
| `commands[].prompt` | yes | Prompt sent to `pi --mode json` |
| `pi.provider` | yes | Provider name (e.g. `anthropic`, `openrouter`) |
| `pi.model` | no | Model override (pi uses provider default) |
| `pi.thinking` | no | Thinking budget: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `postCheckout` | no | Array of shell commands to run after each successful checkout. Commands run via `sh -c`. Stops at first failure. |

Commands are positional — the first array entry maps to menu key `1`, second
to `2`, etc. There are no built-in commands; if you configure zero commands,
the menu shows only `c` (next) and `q` (quit).

## Development

```bash
deno task check    # type-check
deno task test     # run test suite
deno task start    # run the CLI
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for architecture and design
details.
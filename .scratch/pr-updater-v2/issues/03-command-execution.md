# 03 — Command execution: pi spawner + config-driven commands

**What to build:** Adds the user-configured commands from `.pr-updater.yaml` to the interactive menu. When the user picks a command, the CLI spawns `pi --mode json "<prompt>"`, shows a spinner while it runs, prints the session ID on completion, and returns to the status display + menu for the current branch. This completes the full PR-updating workflow.

**Blocked by:** 02 — Interactive branch loop

**Status:** ready-for-agent

- [ ] `pi.ts` defines a `runPiCommand(prompt: string, piConfig: PiConfig)` function that:
  - Spawns `pi --mode json` with the prompt string, provider, model, and thinking settings from config.
  - Shows a spinner (via `@levibostian/sh-style`) while the process runs.
  - Captures stdout and extracts the session ID from pi's JSON output.
  - Returns the session ID.
  - Handles errors: if `pi` is not found on PATH, prints error and exits. If the session fails, prints warning and returns to menu.
- [ ] `main.ts` renders config commands (from config file) in the menu panel with numeric keys (1, 2, 3…) between the separator and "Next branch".
- [ ] Picking a command number routes to `runPiCommand` with that command's prompt, blocking until complete.
- [ ] On completion, prints `✓ Done. Session: <id>` and returns to the status display + menu for the same branch (user can run multiple commands on one branch before moving on).
- [ ] `.pr-updater.yaml` example file at repo root with 2-3 sample commands and pi config.
- [ ] Edge cases: no commands configured (menu falls back to navigation-only from ticket 02), pi not installed (print error, exit), pi session failure (print warning, return to menu).
- [ ] Tests: `pi.test.ts` — mock-a-bin for `pi`, verify spawn args, session ID capture, error handling.
# 01 — Foundation: types, config, gh wrapper, topological sort

**What to build:** A CLI entry point that reads a YAML config, fetches all open PRs via the `gh` CLI, detects the default branch, topologically sorts stacked PRs into update order, and prints the ordered list to stdout. Nothing interactive yet — this is the backbone that all later tickets build on.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] `types.ts` defines shared domain types — `PR`, `PRWithStatus`, `Config`, `Command`, `PiConfig`
- [x] `deno.json` with run/check/test tasks, import map for `@std/yaml`, `@levibostian/sh-style`, `@levibostian/mock-a-bin`, `@std/assert`
- [x] `config.ts` loads `.pr-updater.yaml` (repo root) → `~/.pr-updater.yaml` fallback, validates commands array + pi.provider, throws `ConfigError` on failure
- [x] `gh.ts` — `fetchOpenPRs()`, `fetchDefaultBranch()`, `fetchPRStatus(number)`
- [x] `order.ts` — Kahn's algorithm topological sort, cycle degrades gracefully
- [x] `main.ts` — load config → fetch PRs + default branch → sort → print ordered list
- [x] Tests: `config.test.ts` (8 tests), `gh.test.ts` (5 tests, mock-a-bin), `order.test.ts` (6 tests) — all pass

## Run

```
denom run --allow-read --allow-env --allow-run main.ts
```

## Test

```
denom test --allow-read --allow-write --allow-env --allow-run
```
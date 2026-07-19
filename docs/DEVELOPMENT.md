# Development

## Architecture

```
   main.ts (orchestrator)
    │
    ├── config.ts    — load + validate YAML
    ├── gh.ts        — gh CLI wrapper (PR list, status, default branch)
    ├── git.ts       — git CLI wrapper (checkout, behind-base, worktrees)
    ├── order.ts     — topological sort (pure function, no I/O)
    └── pi.ts        — pi agent spawner (stream JSONL events, capture session ID)
```

### Design patterns

**System boundary isolation.** Every external system (`gh`, `git`, `pi`) has
exactly one module that owns all interaction with it. The rest of the
codebase never calls `new Deno.Command(...)` — it calls a typed function
(`fetchOpenPRs()`, `gitCheckout()`). This keeps the cost of adding or
changing a system boundary to one file and makes the remaining modules
testable without mocks.

**Pure core, impure shell.** `order.ts` is a pure function — takes PR
objects in, returns sorted branch names out. No I/O, no side effects. This
is the only module that contains algorithmic logic (Kahn's topological
sort), and it's tested without any mocking at all. Every other module is an
I/O boundary that delegates to a CLI or filesystem.

**Seam at the binary, not the function.** Rather than abstracting behind a
trait/interface that gets injected (a DI approach), tests use
`mock-a-bin` to replace the actual `gh`/`git`/`pi` binaries on `$PATH` with
shell scripts that return canned JSON. This avoids interface indirection
while keeping tests fast and deterministic. The seam is the OS process
boundary, not a TypeScript interface.

**Thin modules, fat orchestrator.** The wrappers (`gh.ts`, `git.ts`, `pi.ts`,
`config.ts`) are thin — they translate CLI output to typed values or
translate typed values to CLI invocations. `main.ts` holds the orchestration
logic (the interactive loop, status panel rendering, input handling). This is
deliberate: the "how" (choose branch → checkout → fetch status → render →
wait for input → run command) lives in one place, easy to follow and change.

**Logger instance passed through, not global.** `main.ts` accepts an
optional `LoggerInstance` from `@levibostian/sh-style`. Tests capture output
by passing a custom logger. No singleton, no global state, no mocking
required for output verification.

## Test approach

| Module | Strategy | Notes |
|--------|----------|-------|
| `order.ts` | Pure function tests | No mocking. Pass PR arrays, assert sorted output. |
| `config.ts` | Real YAML files in temp dirs | Tests filesystem boundary with real reads. |
| `gh.ts`, `git.ts`, `pi.ts` | `mock-a-bin` | Replace binaries on `$PATH` with scripts returning canned output. |
| `main.ts` (integration) | `mock-a-bin` + capture logger | Full loop with mocked binaries, exercises checkout → status display → menu → next/quit. |

All system-boundary modules follow the same test structure:
1. `mockBin("gh", "bash", script)` replaces the binary for the test scope
2. Call the module function
3. Assert on returned values or captured logger output
4. `cleanup()` restores the original binary

## Key design decisions

- **No built-in commands.** Commands come entirely from config. Zero menu
  entries = show only "next" and "quit". This keeps the tool reusable across
  projects with different workflows and avoids coupling to any specific CI
  or build system.
- **Blocking per command, not concurrent.** Each `pi` session runs to
  completion before the menu returns. No parallel agent spawning — simpler to
  reason about, no risk of conflicting edits across branches.
- **Worktree support, but no auto-creation.** If a branch is checked out in a
  worktree, the tool switches to that directory. It does not create a worktree
  for branches that aren't checked out anywhere — `git checkout` will fail and
  the branch is skipped with a warning.
- **Topological sort degrades gracefully.** Cycles in stacked branches (A→B→A)
  are not handled — remaining nodes are appended in arbitrary order at the
  end. The tool doesn't block on malformed stacks.
# 02 — Interactive branch loop: per-branch status display + navigation

**What to build:** The interactive loop that walks through each branch in the topologically sorted order. For each branch, it checks it out locally, fetches fresh PR status, prints a formatted status panel (CI checks, merge conflicts, behind-base commits, reviews, diff link), and shows a menu with "Next branch" and "Quit" options. No command execution yet — the menu shows only navigation.

**Blocked by:** 01 — Foundation

**Status:** ready-for-agent

- [ ] `main.ts` iterates the ordered branch list from ticket 01. For each branch: `git checkout <branch>` — prints error + skips if checkout fails.
- [ ] Calls `fetchPRStatus(number)` from `gh.ts` per branch.
- [ ] Computes behind-base: compares `headRefOid` against the base branch's latest OID (fetched via `git merge-base --is-ancestor` or equivalent) and reports commit count behind.
- [ ] Displays a formatted status panel using `@levibostian/sh-style`:
  ```
  ========================================================================
                    PR #42 — feat/add-auth (2/5)
  ========================================================================
  checks:  ● unit-tests  ✗ build
  merge:   ● clean
  behind:  4 commits behind main
  review:  ⚠ 1 pending
  diffs:   https://github.com/.../files
  ------------------------------------------------------------------------
  Commands
  ------------------------------------------------------------------------
    c  Next branch
    q  Quit
  ```
- [ ] Reads user input: `c` → advance to next branch, `q` → exit, anything else → re-prompt.
- [ ] Edge cases: no open PRs (print "No open PRs" and exit), checkout failure (skip branch, continue loop), single PR (process then exit).
- [ ] Tests: `main.test.ts` — integrated test with `mock-a-bin` mocking `gh` and `git`. Verifies loop flow, status display content, navigation commands, checkout failure skip.
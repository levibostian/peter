import { assertEquals } from "@std/assert"
import { mockBin } from "@levibostian/mock-a-bin"
import { gitCheckout, countBehindBase, listWorktrees, findWorktreeDir } from "./git.ts"

Deno.test("gitCheckout — returns true on success", async () => {
  const cleanup = await mockBin("git", "bash", `
    case "$1" in
      checkout) exit 0 ;;
      *) exit 1 ;;
    esac
  `)
  try {
    const ok = gitCheckout("feat/a")
    assertEquals(ok, true)
  } finally {
    cleanup()
  }
})

Deno.test("gitCheckout — returns false on failure", async () => {
  const cleanup = await mockBin("git", "bash", `
    case "$1" in
      checkout) echo "error: pathspec 'feat/x' did not match any file(s) known to git" >&2; exit 1 ;;
      *) exit 1 ;;
    esac
  `)
  try {
    const ok = gitCheckout("feat/x")
    assertEquals(ok, false)
  } finally {
    cleanup()
  }
})

Deno.test("countBehindBase — returns commit count", async () => {
  const cleanup = await mockBin("git", "bash", `
    case "$1" in
      fetch) exit 0 ;;
      rev-list) echo "3"; exit 0 ;;
      *) exit 1 ;;
    esac
  `)
  try {
    const count = countBehindBase("abc123", "main")
    assertEquals(count, 3)
  } finally {
    cleanup()
  }
})

Deno.test("countBehindBase — returns 0 on fetch failure", async () => {
  const cleanup = await mockBin("git", "bash", `
    case "$1" in
      fetch) echo "fatal: could not fetch" >&2; exit 1 ;;
      rev-list) echo "5"; exit 0 ;;
      *) exit 1 ;;
    esac
  `)
  try {
    const count = countBehindBase("abc123", "nonexistent")
    assertEquals(count, 0)
  } finally {
    cleanup()
  }
})

Deno.test("countBehindBase — returns 0 on rev-list failure", async () => {
  const cleanup = await mockBin("git", "bash", `
    case "$1" in
      fetch) exit 0 ;;
      rev-list) echo "fatal: ambiguous argument" >&2; exit 1 ;;
      *) exit 1 ;;
    esac
  `)
  try {
    const count = countBehindBase("abc123", "main")
    assertEquals(count, 0)
  } finally {
    cleanup()
  }
})

Deno.test("countBehindBase — returns 0 when not a number", async () => {
  const cleanup = await mockBin("git", "bash", `
    case "$1" in
      fetch) exit 0 ;;
      rev-list) echo ""; exit 0 ;;
      *) exit 1 ;;
    esac
  `)
  try {
    const count = countBehindBase("abc123", "main")
    assertEquals(count, 0)
  } finally {
    cleanup()
  }
})

Deno.test("listWorktrees — parses porcelain output into entries", async () => {
  const cleanup = await mockBin("git", "bash", `
    case "$1" in
      worktree)
        echo "worktree /Users/me/code/main"
        echo "HEAD a1b2c3"
        echo "branch refs/heads/main"
        echo ""
        echo "worktree /Users/me/code/feat-x"
        echo "HEAD d4e5f6"
        echo "branch refs/heads/feat/x"
        exit 0
        ;;
      *) exit 1 ;;
    esac
  `)
  try {
    const entries = listWorktrees()
    assertEquals(entries.length, 2)
    assertEquals(entries[0].path, "/Users/me/code/main")
    assertEquals(entries[0].branch, "main")
    assertEquals(entries[1].path, "/Users/me/code/feat-x")
    assertEquals(entries[1].branch, "feat/x")
  } finally {
    cleanup()
  }
})

Deno.test("listWorktrees — returns empty on failure", async () => {
  const cleanup = await mockBin("git", "bash", `
    case "$1" in
      worktree) echo "fatal: not a git repository" >&2; exit 1 ;;
      *) exit 1 ;;
    esac
  `)
  try {
    const entries = listWorktrees()
    assertEquals(entries, [])
  } finally {
    cleanup()
  }
})

Deno.test("findWorktreeDir — returns path for known branch", async () => {
  const cleanup = await mockBin("git", "bash", `
    case "$1" in
      worktree)
        echo "worktree /Users/me/code/main"
        echo "HEAD a1b2c3"
        echo "branch refs/heads/main"
        echo ""
        echo "worktree /Users/me/code/feat-x"
        echo "HEAD d4e5f6"
        echo "branch refs/heads/feat/x"
        exit 0
        ;;
      *) exit 1 ;;
    esac
  `)
  try {
    const dir = findWorktreeDir("feat/x")
    assertEquals(dir, "/Users/me/code/feat-x")
  } finally {
    cleanup()
  }
})

Deno.test("findWorktreeDir — returns null for unknown branch", async () => {
  const cleanup = await mockBin("git", "bash", `
    case "$1" in
      worktree)
        echo "worktree /Users/me/code/main"
        echo "HEAD a1b2c3"
        echo "branch refs/heads/main"
        exit 0
        ;;
      *) exit 1 ;;
    esac
  `)
  try {
    const dir = findWorktreeDir("nonexistent")
    assertEquals(dir, null)
  } finally {
    cleanup()
  }
})

Deno.test("findWorktreeDir — returns null when worktree list fails", async () => {
  const cleanup = await mockBin("git", "bash", `
    case "$1" in
      worktree) echo "fatal: not a git repository" >&2; exit 1 ;;
      *) exit 1 ;;
    esac
  `)
  try {
    const dir = findWorktreeDir("feat/x")
    assertEquals(dir, null)
  } finally {
    cleanup()
  }
})

Deno.test("findWorktreeDir — returns null for detached worktree", async () => {
  const cleanup = await mockBin("git", "bash", `
    case "$1" in
      worktree)
        echo "worktree /Users/me/code/feature"
        echo "HEAD a1b2c3"
        echo "detached"
        exit 0
        ;;
      *) exit 1 ;;
    esac
  `)
  try {
    const dir = findWorktreeDir("feat/x")
    assertEquals(dir, null)
  } finally {
    cleanup()
  }
})
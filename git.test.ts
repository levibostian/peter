import { assertEquals } from "@std/assert"
import { mockBin } from "@levibostian/mock-a-bin"
import { gitCheckout, countBehindBase } from "./git.ts"

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
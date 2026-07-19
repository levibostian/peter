import { assertEquals } from "@std/assert"
import { sortPRs } from "./order.ts"
import type { PR } from "./types.ts"

function makePR(
  number: number,
  headRefName: string,
  baseRefName: string,
): PR {
  return {
    number,
    headRefName,
    baseRefName,
    headRefOid: "oid",
    statusCheckRollup: [],
    reviews: [],
    mergeable: "MERGEABLE",
  }
}

Deno.test("sortPRs — empty list", () => {
  assertEquals(sortPRs([]), [])
})

Deno.test("sortPRs — single PR with unknown base", () => {
  const prs = [makePR(1, "feat/a", "main")]
  assertEquals(sortPRs(prs), ["feat/a"])
})

Deno.test("sortPRs — linear chain", () => {
  const prs = [
    makePR(3, "feat/c", "feat/b"),
    makePR(1, "feat/a", "main"),
    makePR(2, "feat/b", "feat/a"),
  ]
  assertEquals(sortPRs(prs), ["feat/a", "feat/b", "feat/c"])
})

Deno.test("sortPRs — fork (two branches based on same parent)", () => {
  const prs = [
    makePR(1, "feat/a", "main"),
    makePR(2, "feat/b", "feat/a"),
    makePR(3, "feat/c", "feat/a"),
  ]
  const ordered = sortPRs(prs)
  // feat/a must be first
  assertEquals(ordered[0], "feat/a")
  // feat/b and feat/c can be in any order
  assertEquals(ordered.slice(1).sort(), ["feat/b", "feat/c"])
})

Deno.test("sortPRs — no stack (all independent)", () => {
  const prs = [
    makePR(1, "feat/a", "main"),
    makePR(2, "feat/b", "main"),
    makePR(3, "feat/c", "main"),
  ]
  // No dependencies → order is arbitrary (insertion order from degree map)
  const ordered = sortPRs(prs)
  assertEquals(ordered.length, 3)
  // All branches present
  assertEquals(new Set(ordered), new Set(["feat/a", "feat/b", "feat/c"]))
})

Deno.test("sortPRs — cycle degrades gracefully", () => {
  const prs = [
    makePR(1, "feat/a", "feat/b"),
    makePR(2, "feat/b", "feat/a"),
  ]
  const ordered = sortPRs(prs)
  assertEquals(ordered.length, 2)
  // Both branches present (order is cycle's arbitrary remainder)
  assertEquals(new Set(ordered), new Set(["feat/a", "feat/b"]))
})

Deno.test("sortPRs — all stacked on teammates (base not in PR list)", () => {
  // All PRs base on branches not in our PR list (teammate's branches)
  const prs = [
    makePR(1, "feat/a", "teammate/feature"),
    makePR(2, "feat/b", "teammate/other"),
  ]
  const ordered = sortPRs(prs)
  assertEquals(ordered.length, 2)
  assertEquals(new Set(ordered), new Set(["feat/a", "feat/b"]))
})
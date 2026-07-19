import { assertEquals, assertThrows } from "@std/assert"
import { mockBin } from "@levibostian/mock-a-bin"
import { fetchOpenPRs, fetchPRStatus } from "./gh.ts"

Deno.test("fetchOpenPRs — returns parsed PRs", async () => {
  const cleanup = await mockBin("gh", "bash", `
    echo '[{"number":42,"headRefName":"feat/x","baseRefName":"feat/y","headRefOid":"abc123","statusCheckRollup":[],"reviews":[],"mergeable":"MERGEABLE"}]'
  `)
  try {
    const prs = fetchOpenPRs()
    assertEquals(prs.length, 1)
    assertEquals(prs[0].number, 42)
    assertEquals(prs[0].headRefName, "feat/x")
    assertEquals(prs[0].mergeable, "MERGEABLE")
  } finally {
    cleanup()
  }
})

Deno.test("fetchOpenPRs — returns empty array on no PRs", async () => {
  const cleanup = await mockBin("gh", "bash", `echo ''`)
  try {
    const prs = fetchOpenPRs()
    assertEquals(prs, [])
  } finally {
    cleanup()
  }
})

Deno.test("fetchPRStatus — returns parsed PR", async () => {
  const cleanup = await mockBin("gh", "bash", `
    echo '{"number":7,"headRefName":"feat/z","baseRefName":"main","headRefOid":"def456","statusCheckRollup":[],"reviews":[],"mergeable":"CONFLICTING","url":"https://github.com/org/repo/pull/7"}'
  `)
  try {
    const pr = fetchPRStatus(7)
    assertEquals(pr.number, 7)
    assertEquals(pr.mergeable, "CONFLICTING")
    assertEquals(pr.url, "https://github.com/org/repo/pull/7")
  } finally {
    cleanup()
  }
})

Deno.test("fetchOpenPRs — throws on gh error", async () => {
  const cleanup = await mockBin("gh", "bash", `
    echo "gh: not logged in" >&2
    exit 1
  `)
  try {
    assertThrows(
      () => fetchOpenPRs(),
      "gh pr list",
    )
  } finally {
    cleanup()
  }
})
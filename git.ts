/** Checkout a branch. Returns true on success, false on failure. */
export function gitCheckout(branch: string): boolean {
  const cmd = new Deno.Command("git", {
    args: ["checkout", branch],
    stdout: "null",
    stderr: "null",
  })
  const out = cmd.outputSync()
  return out.success
}

/**
 * Count commits the PR branch is behind its base branch.
 *
 * Fetches the latest base branch from origin, then counts commits
 * in the base that aren't in the PR head. Returns 0 on any failure
 * (network error, unknown branch, etc.).
 */
export function countBehindBase(headRefOid: string, baseBranch: string): number {
  // Fetch latest base branch
  const fetchCmd = new Deno.Command("git", {
    args: ["fetch", "origin", baseBranch],
    stdout: "null",
    stderr: "null",
  })
  const fetchOut = fetchCmd.outputSync()
  if (!fetchOut.success) return 0

  // Count behind: commits in base not in head
  const revCmd = new Deno.Command("git", {
    args: ["rev-list", "--count", `${headRefOid}..origin/${baseBranch}`],
    stdout: "piped",
    stderr: "null",
  })
  const revOut = revCmd.outputSync()
  if (!revOut.success) return 0

  const countStr = new TextDecoder().decode(revOut.stdout).trim()
  const count = parseInt(countStr, 10)
  return Number.isNaN(count) ? 0 : count
}
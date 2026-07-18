import type { PR } from "./types.ts"

/**
 * Topologically sort PRs into update order using Kahn's algorithm.
 *
 * A PR's parent is any PR whose headRefName matches this PR's baseRefName
 * (when baseRefName !== defaultBranch). Roots are PRs whose base is the
 * default branch or whose base branch isn't in the PR list.
 *
 * Returns branch names in update order (parents before children).
 * Cycles degrade gracefully: remaining nodes appended in arbitrary order.
 */
export function sortPRs(prs: PR[], defaultBranch: string): string[] {
  if (prs.length === 0) return []

  // Build adjacency: parent head → child heads
  const headByBase = new Map<string, string[]>()  // baseRefName → [headRefName]
  for (const pr of prs) {
    const base = pr.baseRefName
    if (base !== defaultBranch) {
      if (!headByBase.has(base)) headByBase.set(base, [])
      headByBase.get(base)!.push(pr.headRefName)
    }
  }

  // Track in-degree per head branch
  const inDegree = new Map<string, number>()
  for (const pr of prs) inDegree.set(pr.headRefName, 0)
  for (const pr of prs) {
    const base = pr.baseRefName
    if (base !== defaultBranch && inDegree.has(base)) {
      // pr's base is another PR's head → pr is a child
      inDegree.set(pr.headRefName, (inDegree.get(pr.headRefName) ?? 0) + 1)
    }
  }

  // Queue roots (in-degree 0)
  const queue: string[] = []
  for (const [head, deg] of inDegree) {
    if (deg === 0) queue.push(head)
  }

  const ordered: string[] = []
  while (queue.length > 0) {
    const head = queue.shift()!
    ordered.push(head)

    const children = headByBase.get(head) ?? []
    for (const child of children) {
      const deg = (inDegree.get(child) ?? 1) - 1
      inDegree.set(child, deg)
      if (deg === 0) queue.push(child)
    }
  }

  // Append any remaining nodes (cycles or unreachable)
  for (const [head, deg] of inDegree) {
    if (deg > 0 && !ordered.includes(head)) {
      ordered.push(head)
    }
  }

  return ordered
}
import type { PR } from "./types.ts"

/**
 * Topologically sort PRs into update order using Kahn's algorithm.
 *
 * A PR is a child of another PR when its baseRefName equals that PR's
 * headRefName. Roots are PRs whose base branch isn't another PR's head
 * (could be the default branch, a teammate's branch, etc.).
 *
 * Returns branch names in update order (parents before children).
 * Cycles degrade gracefully: remaining nodes appended in arbitrary order.
 */
export function sortPRs(prs: PR[]): string[] {
  if (prs.length === 0) return []

  const heads = new Set(prs.map((p) => p.headRefName))

  // Build adjacency: parent head → child heads
  const headByBase = new Map<string, string[]>()
  for (const pr of prs) {
    if (heads.has(pr.baseRefName)) {
      if (!headByBase.has(pr.baseRefName)) headByBase.set(pr.baseRefName, [])
      headByBase.get(pr.baseRefName)!.push(pr.headRefName)
    }
  }

  // Track in-degree per head branch
  const inDegree = new Map<string, number>()
  for (const pr of prs) inDegree.set(pr.headRefName, 0)
  for (const pr of prs) {
    if (heads.has(pr.baseRefName)) {
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
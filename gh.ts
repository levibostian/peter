import type { CheckRun, PR, ReviewThreadCounts } from "./types.ts"

/** Run a gh CLI command and return stdout as string. Throws on non-zero exit. */
function gh(args: string[]): string {
  const cmd = new Deno.Command("gh", { args, stdout: "piped", stderr: "piped" })
  const out = cmd.outputSync()
  if (!out.success) {
    const stderr = new TextDecoder().decode(out.stderr).trim()
    throw new Error(`gh ${args.join(" ")} failed: ${stderr}`)
  }
  return new TextDecoder().decode(out.stdout).trim()
}

/** Normalize gh API items (CheckRun/StatusContext) into consistent {name, state}. */
function normalizeChecks(items: unknown[]): CheckRun[] {
  return (items as Record<string, unknown>[]).map((raw) => {
    if (raw.__typename === "StatusContext") {
      return { name: raw.context as string, state: raw.state as string }
    }
    // CheckRun — conclusion holds the result, status holds progress
    const state = ((raw.conclusion ?? raw.status) ?? "UNKNOWN") as string
    return { name: raw.name as string, state }
  })
}

/** Fetch all open PRs for the current repo. */
export function fetchOpenPRs(): PR[] {
  const json = gh([
    "pr", "list",
    "--author", "@me",
    "--json", "number,headRefName,baseRefName,headRefOid,statusCheckRollup,reviews,reviewRequests,mergeable",
  ])
  if (json === "") return []
  return (JSON.parse(json) as PR[]).map((pr) => ({
    ...pr,
    statusCheckRollup: normalizeChecks(pr.statusCheckRollup as unknown as unknown[]),
  }))
}

/** Get the current repo owner/name from gh. */
function getRepoOwnerName(): [string, string] {
  const json = JSON.parse(gh(["repo", "view", "--json", "nameWithOwner"]))
  return (json.nameWithOwner as string).split("/") as [string, string]
}

/** Fetch resolved/unresolved review thread counts for a PR. */
export function fetchReviewThreadCounts(prNumber: number): ReviewThreadCounts {
  const [owner, name] = getRepoOwnerName()
  const query = `query($owner:String!,$repo:String!,$pr:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$pr){reviewThreads(first:100){nodes{isResolved}}}}}`
  const result = JSON.parse(gh(["api", "graphql", "-f", `query=${query}`, "-F", `owner=${owner}`, "-F", `repo=${name}`, "-F", `pr=${prNumber}`]))
  const nodes = result.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []
  const resolved = nodes.filter((n: { isResolved: boolean }) => n.isResolved).length
  const unresolved = nodes.filter((n: { isResolved: boolean }) => !n.isResolved).length
  return { total: nodes.length, resolved, unresolved }
}

/** Fetch enriched status for a specific PR number. */
export function fetchPRStatus(number: number): PR {
  const json = gh([
    "pr", "view", String(number),
    "--json", "number,headRefName,baseRefName,headRefOid,statusCheckRollup,reviews,reviewRequests,mergeable,url",
  ])
  const pr = JSON.parse(json) as PR
  pr.statusCheckRollup = normalizeChecks(pr.statusCheckRollup as unknown as unknown[])
  return pr
}
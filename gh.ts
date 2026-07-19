import type { CheckRun, PR } from "./types.ts"

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
    "--json", "number,headRefName,baseRefName,headRefOid,statusCheckRollup,reviews,mergeable",
  ])
  if (json === "") return []
  return (JSON.parse(json) as PR[]).map((pr) => ({
    ...pr,
    statusCheckRollup: normalizeChecks(pr.statusCheckRollup as unknown as unknown[]),
  }))
}

/** Fetch enriched status for a specific PR number. */
export function fetchPRStatus(number: number): PR {
  const json = gh([
    "pr", "view", String(number),
    "--json", "number,headRefName,baseRefName,headRefOid,statusCheckRollup,reviews,mergeable,url",
  ])
  const pr = JSON.parse(json) as PR
  pr.statusCheckRollup = normalizeChecks(pr.statusCheckRollup as unknown as unknown[])
  return pr
}
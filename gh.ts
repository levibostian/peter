import type { PR } from "./types.ts"

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

/** Fetch all open PRs for the current repo. */
export function fetchOpenPRs(): PR[] {
  const json = gh([
    "pr", "list",
    "--json", "number,headRefName,baseRefName,headRefOid,statusCheckRollup,reviews,mergeable",
  ])
  if (json === "") return []
  return JSON.parse(json) as PR[]
}

/** Detect the repo's default branch name. */
export function fetchDefaultBranch(): string {
  const json = gh(["repo", "view", "--json", "defaultBranch"])
  return (JSON.parse(json) as { defaultBranch: string }).defaultBranch
}

/** Fetch enriched status for a specific PR number. */
export function fetchPRStatus(number: number): PR {
  const json = gh([
    "pr", "view", String(number),
    "--json", "number,headRefName,baseRefName,headRefOid,statusCheckRollup,reviews,mergeable,url",
  ])
  return JSON.parse(json) as PR
}
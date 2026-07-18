import { loadConfig, ConfigError } from "./config.ts"
import { fetchDefaultBranch, fetchOpenPRs } from "./gh.ts"
import { sortPRs } from "./order.ts"
import { createLogger } from "@levibostian/sh-style"

const log = createLogger()

function main() {
  try {
    loadConfig()
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`error: ${err.message}`)
      Deno.exit(1)
    }
    throw err
  }

  const prs = fetchOpenPRs()
  if (prs.length === 0) {
    log.msg("No open PRs")
    Deno.exit(0)
  }

  log.msg(`Found ${prs.length} open PR(s)`)

  const defaultBranch = fetchDefaultBranch()
  log.note(`Default branch: ${defaultBranch}`)

  const ordered = sortPRs(prs, defaultBranch)

  log.phase("Update order")

  const prByHead = new Map(prs.map((p) => [p.headRefName, p]))

  for (let i = 0; i < ordered.length; i++) {
    const branch = ordered[i]
    const pr = prByHead.get(branch)
    if (pr) {
      log.step(`#${pr.number} — ${pr.headRefName} → ${pr.baseRefName}`)
    } else {
      log.step(`#${branch}`)
    }
  }
}

if (import.meta.main) {
  main()
}
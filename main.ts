import { loadConfig, ConfigError } from "./config.ts"
import { fetchOpenPRs, fetchPRStatus } from "./gh.ts"
import { sortPRs } from "./order.ts"
import { gitCheckout, countBehindBase } from "./git.ts"
import { runPiCommand } from "./pi.ts"
import { createLogger, type LoggerInstance } from "@levibostian/sh-style"
import type { PR, CheckRun, Config } from "./types.ts"

export type InputReader = () => string | null

/** Default reader: reads one line from stdin, returns null on EOF. */
export function readLine(): string | null {
  const buf = new Uint8Array(1024)
  try {
    const n = Deno.stdin.readSync(buf)
    if (n === null || n === 0) return null
    return new TextDecoder().decode(buf.subarray(0, n)).trim()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Status panel rendering
// ---------------------------------------------------------------------------

function checkSymbol(state: string): string {
  switch (state) {
    case "SUCCESS":
      return "✓"
    case "FAILURE":
    case "ERROR":
      return "✗"
    case "PENDING":
    case "EXPECTED":
      return "●"
    default:
      return "?"
  }
}

function mergeLabel(state: string): string {
  switch (state) {
    case "MERGEABLE":
      return "● clean"
    case "CONFLICTING":
      return "✗ conflicts"
    default:
      return "? unknown"
  }
}

/** Render a single line of the status panel using the logger. */
function renderStatusPanel(
  log: LoggerInstance,
  pr: PR,
  behindCount: number,
  index: number,
  total: number,
  commands: Config["commands"] = [],
  ordered: string[] = [],
): void {
  const width = 72
  const sep = "=".repeat(width)
  const subSep = "-".repeat(width)

  log.msg(sep)
  log.msg(`         PR #${pr.number} — ${pr.headRefName} (${index}/${total})`)
  log.msg(sep)

  // Checks
  if (pr.statusCheckRollup.length > 0) {
    const parts = pr.statusCheckRollup.map(
      (c: CheckRun) => `${checkSymbol(c.state)} ${c.name}`,
    )
    log.msg(`checks:  ${parts.join("  ")}`)
  }

  // Merge
  log.msg(`merge:   ${mergeLabel(pr.mergeable)}`)

  // Behind
  log.msg(`behind:  ${behindCount} commit${behindCount === 1 ? "" : "s"} behind ${pr.baseRefName}`)

  // Reviews
  const reviews = pr.reviews ?? []
  if (reviews.length > 0) {
    const hasChanges = reviews.some((r) => r.state === "CHANGES_REQUESTED")
    const hasApproved = reviews.some((r) => r.state === "APPROVED")
    const pending = reviews.filter((r) => (r.state as string) === "PENDING" || r.state === null).length
    const parts: string[] = []
    if (hasChanges) parts.push("✗ changes requested")
    if (hasApproved) parts.push("✓ approved")
    if (pending > 0) parts.push(`⚠ ${pending} pending`)
    log.msg(`review:  ${parts.join(", ")}`)
  }

  // Diffs link
  if (pr.url) {
    log.msg(`diffs:   ${pr.url}/files`)
  }

  // Branch list (only if more than one branch)
  if (ordered.length > 1) {
    log.msg(subSep)
    log.msg("Branches")
    log.msg(subSep)
    for (let i = 0; i < ordered.length; i++) {
      const marker = i === index - 1 ? "\u2192" : " "
      log.msg(`  ${marker} ${ordered[i]}`)
    }
  }

  log.msg(subSep)
  log.msg("Commands")
  log.msg(subSep)
  for (let i = 0; i < commands.length; i++) {
    log.msg(`  ${i + 1}  ${commands[i].label}`)
  }
  log.msg("  c  Next branch")
  log.msg("  q  Quit")
}

// ---------------------------------------------------------------------------
// Interactive loop
// ---------------------------------------------------------------------------

export interface InteractiveOptions {
  prs: PR[]
  ordered: string[]
  config: Config
  inputReader?: InputReader
  logger?: LoggerInstance
}

export function interactiveMain(options: InteractiveOptions): void {
  const { prs, ordered, config } = options
  const readInput = options.inputReader ?? readLine
  const log = options.logger ?? createLogger()

  if (prs.length === 0) {
    log.msg("No open PRs")
    return
  }

  const prByHead = new Map(prs.map((p) => [p.headRefName, p]))
  const commands = config.commands

  for (let i = 0; i < ordered.length; i++) {
    const branch = ordered[i]
    const pr = prByHead.get(branch)
    if (!pr) continue

    // Checkout
    if (!gitCheckout(branch)) {
      log.warn(`Checkout failed for ${branch}, skipping`)
      continue
    }

    // Fetch fresh PR status
    const status = fetchPRStatus(pr.number)

    // Compute behind-base
    const behind = countBehindBase(status.headRefOid, status.baseRefName)

    // Display status panel
    renderStatusPanel(
      log,
      { ...status, url: status.url },
      behind,
      i + 1,
      ordered.length,
      commands,
      ordered,
    )

    // Menu loop
    for (;;) {
      const input = readInput()
      if (input === null || input === "q") return
      if (input === "c") break

      const cmdIndex = parseInt(input ?? "", 10) - 1
      if (cmdIndex >= 0 && cmdIndex < commands.length) {
        const sessionId = runPiCommand(commands[cmdIndex].prompt, config.pi)
        if (sessionId) {
          log.msg(`\u2713 Done. Session: ${sessionId}`)
        }
        // Re-render status panel
        renderStatusPanel(
          log,
          { ...status, url: status.url },
          behind,
          i + 1,
          ordered.length,
          commands,
          ordered,
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main() {
  let config: Config
  try {
    config = loadConfig()
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`error: ${err.message}`)
      Deno.exit(1)
    }
    throw err
  }

  const prs = fetchOpenPRs()
  const ordered = sortPRs(prs)

  interactiveMain({ prs, ordered, config })
}

if (import.meta.main) {
  main()
}
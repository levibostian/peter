import { loadConfig, ConfigError } from "./config.ts"
import { fetchOpenPRs, fetchPRStatus, fetchReviewThreadCounts } from "./gh.ts"
import { sortPRs } from "./order.ts"
import { gitCheckout, countBehindBase, findWorktreeDir } from "./git.ts"
import { runPiCommand } from "./pi.ts"
import { createLogger, type LoggerInstance } from "@levibostian/sh-style"
import type { PR, CheckRun, Config, ReviewThreadCounts } from "./types.ts"

export type InputReader = () => string | null

/** Default reader: reads one line from stdin, returns null on EOF. */
export function readInput(): string | null {
  const enc = new TextEncoder()
  Deno.stdout.writeSync(enc.encode("> "))
  Deno.stdin.setRaw(true)
  const buf = new Uint8Array(1)
  const n = Deno.stdin.readSync(buf)
  Deno.stdin.setRaw(false)
  if (n === null || n === 0) { console.log(); return null }
  const byte = buf[0]
  if (byte === 3) { console.log(); Deno.exit(0) }
  if (byte === 10 || byte === 13) { console.log(); return "" }
  const char = String.fromCharCode(byte)
  console.log(char)
  return char
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
    case "CANCELLED":
      return "✗"
    case "PENDING":
    case "EXPECTED":
    case "QUEUED":
    case "IN_PROGRESS":
    case "WAITING":
    case "NEUTRAL":
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
  threadCounts?: { total: number; resolved: number; unresolved: number },
): void {
  const width = 72
  const sep = "=".repeat(width)
  const subSep = "-".repeat(width)

  log.msg(sep)
  log.msg(`         PR #${pr.number} — ${pr.headRefName} → ${pr.baseRefName} (${index}/${total})`)
  log.msg(sep)

  // Checks
  if (pr.statusCheckRollup.length > 0) {
    const lines = pr.statusCheckRollup.map(
      (c: CheckRun) => `  ${checkSymbol(c.state)} ${c.name}`,
    )
    log.msg(`checks:\n${lines.join("\n")}`)
  }

  // Merge
  log.msg(`merge:   ${mergeLabel(pr.mergeable)}`)

  // Behind
  log.msg(`behind:  ${behindCount} commit${behindCount === 1 ? "" : "s"} behind ${pr.baseRefName}`)

  // Reviews
  // Reviews — always show section
  const reviews = pr.reviews ?? []
  const reviewRequests = pr.reviewRequests ?? []
  const parts: string[] = []

  // Submitted reviews (existing logic)
  const hasChanges = reviews.some((r) => r.state === "CHANGES_REQUESTED")
  const hasApproved = reviews.some((r) => r.state === "APPROVED")
  const pending = reviews.filter((r) => (r.state as string) === "PENDING" || r.state === null).length
  if (hasChanges) parts.push("✗ changes requested")
  if (hasApproved) parts.push("✓ approved")
  if (pending > 0) parts.push(`⚠ ${pending} pending`)

  // Requested reviewers who haven't submitted a review yet
  const actedAuthors = new Set(reviews.map((r) => r.author))
  const waiting = reviewRequests
    .map((rr) => rr.login ?? rr.name)
    .filter((r): r is string => r !== undefined && !actedAuthors.has(r))
  if (waiting.length > 0) {
    parts.push(`⏳ waiting: ${waiting.join(", ")}`)
  }

  // Nothing at all
  if (parts.length === 0) {
    parts.push("none requested")
  }

  log.msg(`review:  ${parts.join(" | ")}`)

  // Conversations (review threads)
  if (threadCounts && threadCounts.total > 0) {
    log.msg(`convos:  ${threadCounts.resolved} resolved, ${threadCounts.unresolved} unresolved`)
  }

  // Diffs link
  if (pr.url) {
    log.msg(`diffs:   ${pr.url}/files`)
  }

  // Branch list (only if more than one branch)
  if (ordered.length > 1) {
    const lines = ordered.map((b, i) => {
      const marker = i === index - 1 ? "\u2192" : " "
      return `  ${marker} ${b}`
    })
    log.msg(subSep + "\n" + "Branches" + "\n" + subSep)
    log.msg(lines.join("\n"))
  }

  log.msg(subSep + "\n" + "Commands" + "\n" + subSep)
  const cmdLines = commands.map((c, i) => `  ${i + 1}  ${c.label}`)
  cmdLines.push("  r  Refresh", "  c  Next branch", "  q  Quit")
  log.msg(cmdLines.join("\n"))
}

// ---------------------------------------------------------------------------
// Post-checkout commands
// ---------------------------------------------------------------------------

/** Run shell commands after a successful checkout. Stops at first failure. */
export function runPostCheckoutCommands(commands: string[], log: LoggerInstance): boolean {
  for (const cmd of commands) {
    const proc = new Deno.Command("sh", {
      args: ["-c", cmd],
      stdout: "inherit",
      stderr: "inherit",
    })
    const out = proc.outputSync()
    if (!out.success) {
      log.warn(`Post-checkout command failed: ${cmd}`)
      return false
    }
  }
  return true
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

export async function interactiveMain(options: InteractiveOptions): Promise<void> {
  const { prs, ordered, config } = options
  const reader = options.inputReader ?? readInput
  const log = options.logger ?? createLogger()
  const originalCwd = Deno.cwd()

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

    // Resolve worktree directory. If branch is checked out in another
    // worktree, chdir there. If not in any worktree, go back to where
    // the CLI started so we don't linger in a stale worktree directory.
    const worktreeDir = findWorktreeDir(branch)
    if (worktreeDir && Deno.cwd() !== worktreeDir) {
      Deno.chdir(worktreeDir)
    } else if (!worktreeDir && Deno.cwd() !== originalCwd) {
      Deno.chdir(originalCwd)
    }

    // Checkout
    if (!gitCheckout(branch)) {
      log.warn(`Checkout failed for ${branch}, skipping`)
      continue
    }

    // Run post-checkout commands
    if (config.postCheckout && config.postCheckout.length > 0) {
      runPostCheckoutCommands(config.postCheckout, log)
    }

    // Fetch fresh PR status
    let status = fetchPRStatus(pr.number)

    // Compute behind-base
    let behind = countBehindBase(status.headRefOid, status.baseRefName)

    // Display status panel
    const threadCounts = fetchReviewThreadCounts(pr.number)
    renderStatusPanel(
      log,
      { ...status, url: status.url },
      behind,
      i + 1,
      ordered.length,
      commands,
      ordered,
      threadCounts,
    )

    // Menu loop
    for (;;) {
      const input = reader()
      if (input === null || input === "q") return
      if (input === "c") break

      if (input === "r") {
        // Refresh current PR state
        status = fetchPRStatus(pr.number)
        behind = countBehindBase(status.headRefOid, status.baseRefName)
        const refThreadCounts = fetchReviewThreadCounts(pr.number)
        renderStatusPanel(
          log,
          { ...status, url: status.url },
          behind,
          i + 1,
          ordered.length,
          commands,
          ordered,
          refThreadCounts,
        )
        continue
      }

      const cmdIndex = parseInt(input ?? "", 10) - 1
      if (cmdIndex >= 0 && cmdIndex < commands.length) {
        const sessionId = await runPiCommand(commands[cmdIndex].prompt, config.pi)
        if (sessionId) {
          log.msg(`\u2713 Done`)
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

async function main() {
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

  await interactiveMain({ prs, ordered, config })
}

if (import.meta.main) {
  main()
}
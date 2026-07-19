import { loadConfig, ConfigError } from "./config.ts"
import { fetchOpenPRs, fetchPRStatus } from "./gh.ts"
import { sortPRs } from "./order.ts"
import { gitCheckout, countBehindBase, findWorktreeDir } from "./git.ts"
import { runPiCommand } from "./pi.ts"
import { createLogger, type LoggerInstance } from "@levibostian/sh-style"
import type { PR, CheckRun, Config } from "./types.ts"

export type InputReader = () => string | null

/** Default reader: reads one line from stdin, returns null on EOF. */
export function readInput(): string | null {
  const enc = new TextEncoder()
  Deno.stdout.writeSync(enc.encode("> "))

  Deno.stdin.setRaw(true)
  const buf = new Uint8Array(1)
  const n = Deno.stdin.readSync(buf)
  Deno.stdin.setRaw(false)

  if (n === null || n === 0) {
    console.log()
    return null
  }

  const byte = buf[0]

  if (byte === 3) {
    // Ctrl+C
    console.log()
    Deno.exit(0)
  }

  if (byte === 10 || byte === 13) {
    // Enter → no-op
    console.log()
    return ""
  }

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
    const lines = ordered.map((b, i) => {
      const marker = i === index - 1 ? "\u2192" : " "
      return `  ${marker} ${b}`
    })
    log.msg(subSep + "\n" + "Branches" + "\n" + subSep)
    log.msg(lines.join("\n"))
  }

  log.msg(subSep + "\n" + "Commands" + "\n" + subSep)
  const cmdLines = commands.map((c, i) => `  ${i + 1}  ${c.label}`)
  cmdLines.push("  c  Next branch", "  q  Quit")
  log.msg(cmdLines.join("\n"))
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

    // Resolve worktree directory (if branch is checked out in another worktree)
    const worktreeDir = findWorktreeDir(branch)
    if (worktreeDir && Deno.cwd() !== worktreeDir) {
      Deno.chdir(worktreeDir)
    }

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
      const input = reader()
      if (input === null || input === "q") return
      if (input === "c") break

      const cmdIndex = parseInt(input ?? "", 10) - 1
      if (cmdIndex >= 0 && cmdIndex < commands.length) {
        const sessionId = await runPiCommand(commands[cmdIndex].prompt, config.pi)
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
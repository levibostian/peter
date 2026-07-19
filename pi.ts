import type { PiConfig } from "./types.ts"

/**
 * Run pi --mode json with the given prompt and config.
 *
 * Spawns pi, shows spinner, captures session ID from first JSON line.
 * Returns session ID string on success, null on session failure.
 * Exits on "pi not found" — that's a setup problem, not recoverable.
 */
export function runPiCommand(prompt: string, piConfig: PiConfig): string | null {
  const args = ["--mode", "json", "--provider", piConfig.provider]
  if (piConfig.model) args.push("--model", piConfig.model)
  if (piConfig.thinking) args.push("--thinking", piConfig.thinking)
  args.push(prompt)

  const cmd = new Deno.Command("pi", { args, stdout: "piped", stderr: "piped" })

  // outputSync throws when the binary doesn't exist on PATH
  let out: Deno.CommandOutput
  const spinner = showSpinner("Running pi command...")
  try {
    out = cmd.outputSync()
  } catch {
    spinner.stop()
    console.error("error: pi not found on PATH. Install pi to use this feature.")
    Deno.exit(1)
  }
  const stderr = new TextDecoder().decode(out.stderr).trim()
  spinner.stop()

  if (!out.success) {
    console.warn(`warning: pi command failed: ${stderr}`)
    return null
  }

  const stdout = new TextDecoder().decode(out.stdout).trim()
  const sessionId = extractSessionId(stdout)
  if (!sessionId) {
    console.warn("warning: could not extract session ID from pi output")
    return null
  }

  return sessionId
}

/** Extract session ID from the first JSON line of pi's stdout. */
function extractSessionId(stdout: string): string | null {
  const firstLine = stdout.split("\n")[0]
  if (!firstLine) return null
  try {
    const parsed = JSON.parse(firstLine)
    if (parsed.type === "session" && typeof parsed.id === "string") {
      return parsed.id
    }
  } catch {
    // not valid JSON
  }
  return null
}

/**
 * Minimal spinner. Since Deno.Command.outputSync blocks the event loop,
 * this writes a static indicator before + clears after. The frames won't
 * animate during a sync call, but it still visually marks "something is
 * running".
 */
function showSpinner(label: string): { stop: () => void } {
  const enc = new TextEncoder()
  Deno.stdout.writeSync(enc.encode(`  ${label}`))
  return {
    stop: () => {
      Deno.stdout.writeSync(enc.encode("\r\x1b[K"))
    },
  }
}
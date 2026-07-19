import type { PiConfig } from "./types.ts"

const enc = new TextEncoder()

/**
 * Run pi --mode json with the given prompt and config.
 *
 * Spawns pi, streams JSONL events to show progress, captures session ID.
 * Returns session ID on success, null on session failure.
 */
export async function runPiCommand(prompt: string, piConfig: PiConfig): Promise<string | null> {
  textBuffer = ""
  const args = ["--mode", "json", "--provider", piConfig.provider]
  if (piConfig.model) args.push("--model", piConfig.model)
  if (piConfig.thinking) args.push("--thinking", piConfig.thinking)
  args.push(prompt)

  const cmd = new Deno.Command("pi", { args, stdout: "piped", stderr: "piped" })

  let process: Deno.ChildProcess
  try {
    process = cmd.spawn()
  } catch {
    console.error("error: pi not found on PATH. Install pi to use this feature.")
    Deno.exit(1)
  }

  const reader = process.stdout.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let sessionId: string | null = null

  for (;;) {
    const { done, value } = await reader.read()
    if (done && buffer.length === 0) break
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: done })

    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      if (!line.trim()) continue
      const event = parseEvent(line)
      if (!event) continue
      if (event.type === "session" && typeof event.id === "string") {
        sessionId = event.id
      }
      showProgress(event)
    }
  }

  const status = await process.status
  reader.releaseLock()

  if (!status.success) {
    const stderr = await collectStderr(process)
    console.warn(`warning: pi command failed: ${stderr}`)
    return null
  }

  await process.stderr.cancel()

  if (!sessionId) {
    console.warn("warning: could not extract session ID from pi output")
    return null
  }

  return sessionId
}

/** Parse one JSON line, return null on failure. */
function parseEvent(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Buffer for incomplete text line from streaming deltas. */
let textBuffer = ""

/** Show a single progress line for the user. */
function showProgress(event: Record<string, unknown>): void {
  switch (event.type) {
    case "tool_execution_start":
      // Finalize any pending text before showing next tool
      if (textBuffer.length > 0) {
        Deno.stdout.writeSync(enc.encode(`\r\x1b[K  pi: ${textBuffer}\n`))
        textBuffer = ""
      }
      {
        const toolName = String(event.toolName ?? "?")
        const toolArgs = event.args as Record<string, unknown> ?? {}
        const detail = toolName === "bash"
          ? (String(toolArgs.command ?? "").slice(0, 80))
          : toolName === "read"
          ? String(toolArgs.path ?? "")
          : toolName === "write" || toolName === "edit"
          ? String(toolArgs.path ?? "")
          : ""
        const suffix = detail ? ` ${detail}` : ""
        writeLine(`  pi: \u2699 ${toolName}${suffix}`)
      }
      break
    case "message_update": {
      const msgEvent = event.assistantMessageEvent as Record<string, unknown> | undefined
      if (msgEvent?.type === "text_delta" && typeof msgEvent.delta === "string") {
        textBuffer += msgEvent.delta
        // Overwrite current line with accumulated text (no newline yet)
        Deno.stdout.writeSync(enc.encode(`\r\x1b[K  pi: ${textBuffer}`))
      }
      break
    }
    case "message_end":
    case "turn_end":
    case "agent_end":
      // Finalize the accumulated text line with newline
      if (textBuffer.length > 0) {
        Deno.stdout.writeSync(enc.encode(`\r\x1b[K  pi: ${textBuffer}\n`))
        textBuffer = ""
      }
      break
    case "message_start":
      textBuffer = ""
      break
    case "compaction_start":
      writeLine(`  pi: compacting context...`)
      break
    case "auto_retry_start": {
      const attempt = String(event.attempt ?? "?")
      const max = String(event.maxAttempts ?? "?")
      writeLine(`  pi: retry ${attempt}/${max}...`)
      break
    }
  }
}



/** Write a line to stdout (cleared after command finishes). */
function writeLine(text: string): void {
  Deno.stdout.writeSync(enc.encode(text + "\n"))
}

/** Collect stderr from a finished child process. */
async function collectStderr(process: Deno.ChildProcess): Promise<string> {
  const reader = process.stderr.getReader()
  const decoder = new TextDecoder()
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  reader.releaseLock()
  return decoder.decode(concatUint8(chunks)).trim()
}

function concatUint8(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    result.set(c, offset)
    offset += c.length
  }
  return result
}
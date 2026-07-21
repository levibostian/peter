import type { PiConfig } from "./types.ts";

const enc = new TextEncoder();

/**
 * Run pi --mode json with the given prompt and config.
 *
 * Spawns pi, streams JSONL events to show progress, captures session ID.
 * Returns session ID on success, null on session failure.
 */
export async function runPiCommand(
  prompt: string,
  piConfig: PiConfig,
): Promise<string | null> {
  const args: string[] = [
    "--mode", "json", "--provider", piConfig.provider!,
  ];
  if (piConfig.model) args.push("--model", piConfig.model);
  if (piConfig.thinking) args.push("--thinking", piConfig.thinking);
  args.push(prompt);

  const cmd = new Deno.Command("pi", {
    args,
    stdout: "piped",
    stderr: "piped",
  });

  let process: Deno.ChildProcess;
  try {
    process = cmd.spawn();
  } catch {
    console.error(
      "error: pi not found on PATH. Install pi to use this feature.",
    );
    Deno.exit(1);
  }

  const reader = process.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sessionId: string | null = null;
  let textBuffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done && buffer.length === 0) break;
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: done });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      let event: Record<string, unknown>;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === "session" && typeof event.id === "string") {
        sessionId = event.id;
        writeLine(`Session: ${sessionId}`);
      }
      textBuffer = showProgress(event, textBuffer);
    }
  }

  const status = await process.status;
  reader.releaseLock();

  if (!status.success) {
    const stderrReader = process.stderr.getReader();
    const stderrChunks: Uint8Array[] = [];
    for (;;) { const { done, value } = await stderrReader.read(); if (done) break; stderrChunks.push(value); }
    stderrReader.releaseLock();
    const total = stderrChunks.reduce((s, c) => s + c.length, 0);
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of stderrChunks) { buf.set(c, off); off += c.length; }
    console.warn(`warning: pi command failed: ${decoder.decode(buf).trim()}`);
    return null;
  }

  await process.stderr.cancel();

  if (!sessionId) {
    console.warn("warning: could not extract session ID from pi output");
    return null;
  }

  return sessionId;
}

/** Show a single progress line for the user. Returns updated textBuffer. */
function showProgress(event: Record<string, unknown>, textBuffer: string): string {
  switch (event.type) {
    case "tool_execution_start":
      // Finalize any pending text before showing next tool
      if (textBuffer.length > 0) {
        writeLine(`  pi: ${textBuffer}`);
        textBuffer = "";
      }
      {
        const toolName = String(event.toolName ?? "?");
        const toolArgs = event.args as Record<string, unknown> ?? {};
        const detail = toolName === "bash"
          ? (String(toolArgs.command ?? "").slice(0, 80))
          : toolName === "read"
          ? String(toolArgs.path ?? "")
          : toolName === "write" || toolName === "edit"
          ? String(toolArgs.path ?? "")
          : "";
        const suffix = detail ? ` ${detail}` : "";
        writeLine(`  pi: \u2699 ${toolName}${suffix}`);
      }
      break;
    case "message_update": {
      const msgEvent = event.assistantMessageEvent as
        | Record<string, unknown>
        | undefined;
      if (
        msgEvent?.type === "text_delta" && typeof msgEvent.delta === "string"
      ) {
        textBuffer += msgEvent.delta;
      }
      break;
    }
    case "message_end":
    case "turn_end":
    case "agent_end":
      if (textBuffer.length > 0) {
        writeLine(`  pi: ${textBuffer}`);
        textBuffer = "";
      }
      break;
    case "message_start":
      textBuffer = "";
      break;
    case "compaction_start":
      writeLine(`  pi: compacting context...`);
      break;
    case "auto_retry_start": {
      const attempt = String(event.attempt ?? "?");
      const max = String(event.maxAttempts ?? "?");
      writeLine(`  pi: retry ${attempt}/${max}...`);
      break;
    }
  }
  return textBuffer;
}

/** Write a line to stdout (cleared after command finishes). */
function writeLine(text: string): void {
  Deno.stdout.writeSync(enc.encode(text + "\n"));
}
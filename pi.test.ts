import { assertEquals, assert } from "@std/assert"
import { mockBin } from "@levibostian/mock-a-bin"
import { runPiCommand } from "./pi.ts"
import type { PiConfig } from "./types.ts"

const testConfig: PiConfig = { provider: "anthropic" }

Deno.test("runPiCommand — extracts session ID from pi JSON output", async () => {
  const cleanup = await mockBin("pi", "bash", `
    echo '{"type":"session","version":3,"id":"019f7a23-76cc-7a39-be39-a475bac32547","timestamp":"2026-07-19T11:29:32.364Z"}'
    exit 0
  `)
  try {
    const sessionId = runPiCommand("test prompt", testConfig)
    assertEquals(sessionId, "019f7a23-76cc-7a39-be39-a475bac32547")
  } finally {
    cleanup()
  }
})

Deno.test("runPiCommand — passes model and thinking when set", async () => {
  const cleanup = await mockBin("pi", "bash", `
    echo '{"type":"session","id":"test-session"}'
    exit 0
  `)
  try {
    const config: PiConfig = {
      provider: "anthropic",
      model: "sonnet",
      thinking: "medium",
    }
    const sessionId = runPiCommand("test prompt", config)
    assertEquals(sessionId, "test-session")
  } finally {
    cleanup()
  }
})

Deno.test("runPiCommand — returns null on pi failure", async () => {
  const cleanup = await mockBin("pi", "bash", `
    echo "error: something went wrong" >&2
    exit 1
  `)
  try {
    const sessionId = runPiCommand("test prompt", testConfig)
    assertEquals(sessionId, null)
  } finally {
    cleanup()
  }
})

Deno.test("runPiCommand — returns null on missing session ID", async () => {
  const cleanup = await mockBin("pi", "bash", `
    echo '{"type":"error","message":"bad"}'
    exit 0
  `)
  try {
    const sessionId = runPiCommand("test prompt", testConfig)
    assertEquals(sessionId, null)
  } finally {
    cleanup()
  }
})
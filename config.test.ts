import { assertEquals, assertThrows } from "@std/assert"
import { loadConfig, ConfigError } from "./config.ts"
import * as path from "node:path"
import * as fs from "node:fs"

function withTempDir(fn: (dir: string) => void) {
  const dir = Deno.makeTempDirSync({ prefix: "pr-updater-test-" })
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

Deno.test("loadConfig — loads from repo root", () => {
  withTempDir((dir) => {
    const yaml = `commands:
  - label: Run tests
    prompt: Run the test suite
pi:
  provider: anthropic
`
    fs.writeFileSync(path.join(dir, ".pr-updater.yaml"), yaml)

    const origCwd = Deno.cwd()
    Deno.chdir(dir)
    try {
      const cfg = loadConfig()
      assertEquals(cfg.commands.length, 1)
      assertEquals(cfg.commands[0].label, "Run tests")
      assertEquals(cfg.pi.provider, "anthropic")
    } finally {
      Deno.chdir(origCwd)
    }
  })
})

Deno.test("loadConfig — falls back to ~/.pr-updater.yaml", () => {
  withTempDir((dir) => {
    const yaml = `commands:
  - label: Lint
    prompt: Run linter
pi:
  provider: openai
`
    fs.writeFileSync(path.join(dir, ".pr-updater.yaml"), yaml)
    Deno.env.set("HOME", dir)

    // Change to a dir without a repo-root config
    const subDir = path.join(dir, "sub")
    fs.mkdirSync(subDir)
    const origCwd = Deno.cwd()
    Deno.chdir(subDir)
    try {
      const cfg = loadConfig()
      assertEquals(cfg.commands[0].label, "Lint")
      assertEquals(cfg.pi.provider, "openai")
    } finally {
      Deno.chdir(origCwd)
    }
  })
})

Deno.test("loadConfig — errors when no config found", () => {
  withTempDir((dir) => {
    Deno.env.set("HOME", dir)
    const origCwd = Deno.cwd()
    Deno.chdir(dir)
    try {
      assertThrows(
        () => loadConfig(),
        ConfigError,
        "no .pr-updater.yaml found",
      )
    } finally {
      Deno.chdir(origCwd)
    }
  })
})

Deno.test("loadConfig — errors on missing commands", () => {
  withTempDir((dir) => {
    const yaml = `pi:
  provider: anthropic
`
    fs.writeFileSync(path.join(dir, ".pr-updater.yaml"), yaml)
    const origCwd = Deno.cwd()
    Deno.chdir(dir)
    try {
      assertThrows(
        () => loadConfig(),
        ConfigError,
        'must contain a "commands" array',
      )
    } finally {
      Deno.chdir(origCwd)
    }
  })
})

Deno.test("loadConfig — errors on missing pi", () => {
  withTempDir((dir) => {
    const yaml = `commands:
  - label: Test
    prompt: Run tests
`
    fs.writeFileSync(path.join(dir, ".pr-updater.yaml"), yaml)
    const origCwd = Deno.cwd()
    Deno.chdir(dir)
    try {
      assertThrows(
        () => loadConfig(),
        ConfigError,
        'must contain a "pi" object',
      )
    } finally {
      Deno.chdir(origCwd)
    }
  })
})

Deno.test("loadConfig — errors on empty pi.provider", () => {
  withTempDir((dir) => {
    const yaml = `commands:
  - label: Test
    prompt: Run tests
pi:
  provider: ""
`
    fs.writeFileSync(path.join(dir, ".pr-updater.yaml"), yaml)
    const origCwd = Deno.cwd()
    Deno.chdir(dir)
    try {
      assertThrows(
        () => loadConfig(),
        ConfigError,
        "pi.provider is required",
      )
    } finally {
      Deno.chdir(origCwd)
    }
  })
})

Deno.test("loadConfig — errors on command missing label", () => {
  withTempDir((dir) => {
    const yaml = `commands:
  - prompt: Run tests
pi:
  provider: anthropic
`
    fs.writeFileSync(path.join(dir, ".pr-updater.yaml"), yaml)
    const origCwd = Deno.cwd()
    Deno.chdir(dir)
    try {
      assertThrows(
        () => loadConfig(),
        ConfigError,
        "commands[0].label is required",
      )
    } finally {
      Deno.chdir(origCwd)
    }
  })
})

Deno.test("loadConfig — errors on YAML parse failure", () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, ".pr-updater.yaml"), "{{invalid")
    const origCwd = Deno.cwd()
    Deno.chdir(dir)
    try {
      assertThrows(
        () => loadConfig(),
        ConfigError,
        "failed to parse",
      )
    } finally {
      Deno.chdir(origCwd)
    }
  })
})
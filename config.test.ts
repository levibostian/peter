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

/** Run code with HOME set to a dir that has no .pr-updater.yaml. */
function withoutHomeConfig(fn: () => void) {
  const origHome = Deno.env.get("HOME")
  Deno.env.set("HOME", "/tmp/pr-updater-test-nonexistent-home")
  try {
    fn()
  } finally {
    if (origHome !== undefined) Deno.env.set("HOME", origHome)
    else Deno.env.delete("HOME")
  }
}

Deno.test("loadConfig — loads from repo root only (no global)", () => {
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
      withoutHomeConfig(() => {
        const cfg = loadConfig()
        assertEquals(cfg.commands.length, 1)
        assertEquals(cfg.commands[0].label, "Run tests")
        assertEquals(cfg.pi.provider, "anthropic")
      })
    } finally {
      Deno.chdir(origCwd)
    }
  })
})

Deno.test("loadConfig — falls back to ~/.pr-updater.yaml when no local config", () => {
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

Deno.test("loadConfig — merges global and local config", () => {
  withTempDir((dir) => {
    const homeDir = path.join(dir, "home")
    const repoDir = path.join(dir, "repo")
    fs.mkdirSync(homeDir)
    fs.mkdirSync(repoDir)

    const globalYaml = `commands:
  - label: Global cmd
    prompt: Global prompt
pi:
  provider: anthropic
  thinking: low
postCheckout:
  - make clean
`
    const localYaml = `commands:
  - label: Local cmd
    prompt: Local prompt
pi:
  provider: openai
postCheckout:
  - npm install
`
    fs.writeFileSync(path.join(homeDir, ".pr-updater.yaml"), globalYaml)
    fs.writeFileSync(path.join(repoDir, ".pr-updater.yaml"), localYaml)

    Deno.env.set("HOME", homeDir)
    const origCwd = Deno.cwd()
    Deno.chdir(repoDir)
    try {
      const cfg = loadConfig()

      // commands concatenated: global first, local second
      assertEquals(cfg.commands.length, 2)
      assertEquals(cfg.commands[0].label, "Global cmd")
      assertEquals(cfg.commands[1].label, "Local cmd")

      // pi: local overrides provider, global thinking preserved
      assertEquals(cfg.pi.provider, "openai")
      assertEquals(cfg.pi.thinking, "low")

      // postCheckout concatenated: global first, local second
      assertEquals(cfg.postCheckout, ["make clean", "npm install"])
    } finally {
      Deno.chdir(origCwd)
    }
  })
})

Deno.test("loadConfig — only global config works", () => {
  withTempDir((dir) => {
    const yaml = `commands:
  - label: Only global
    prompt: Global prompt
pi:
  provider: anthropic
`
    fs.writeFileSync(path.join(dir, ".pr-updater.yaml"), yaml)
    Deno.env.set("HOME", dir)

    const repoDir = path.join(dir, "repo")
    fs.mkdirSync(repoDir)
    const origCwd = Deno.cwd()
    Deno.chdir(repoDir)
    try {
      const cfg = loadConfig()
      assertEquals(cfg.commands.length, 1)
      assertEquals(cfg.commands[0].label, "Only global")
      assertEquals(cfg.pi.provider, "anthropic")
      assertEquals(cfg.postCheckout, undefined)
    } finally {
      Deno.chdir(origCwd)
    }
  })
})

Deno.test("loadConfig — commands concatenated global then local", () => {
  withTempDir((dir) => {
    const homeDir = path.join(dir, "home")
    const repoDir = path.join(dir, "repo")
    fs.mkdirSync(homeDir)
    fs.mkdirSync(repoDir)

    fs.writeFileSync(
      path.join(homeDir, ".pr-updater.yaml"),
      `commands:
  - label: G1
    prompt: g1
  - label: G2
    prompt: g2
pi:
  provider: anthropic
`,
    )
    fs.writeFileSync(
      path.join(repoDir, ".pr-updater.yaml"),
      `commands:
  - label: L1
    prompt: l1
pi:
  provider: anthropic
`,
    )

    Deno.env.set("HOME", homeDir)
    const origCwd = Deno.cwd()
    Deno.chdir(repoDir)
    try {
      const cfg = loadConfig()
      // commands concatenated: global G1, G2 first, then local L1
      assertEquals(cfg.commands.length, 3)
      assertEquals(cfg.commands[0].label, "G1")
      assertEquals(cfg.commands[1].label, "G2")
      assertEquals(cfg.commands[2].label, "L1")
    } finally {
      Deno.chdir(origCwd)
    }
  })
})

Deno.test("loadConfig — local pi fields override global", () => {
  withTempDir((dir) => {
    const homeDir = path.join(dir, "home")
    const repoDir = path.join(dir, "repo")
    fs.mkdirSync(homeDir)
    fs.mkdirSync(repoDir)

    fs.writeFileSync(
      path.join(homeDir, ".pr-updater.yaml"),
      `commands:
  - label: Test
    prompt: test
pi:
  provider: anthropic
  model: haiku
  thinking: low
`,
    )
    fs.writeFileSync(
      path.join(repoDir, ".pr-updater.yaml"),
      `commands:
  - label: Test
    prompt: test
pi:
  model: sonnet
  thinking: high
`,
    )

    Deno.env.set("HOME", homeDir)
    const origCwd = Deno.cwd()
    Deno.chdir(repoDir)
    try {
      const cfg = loadConfig()
      // provider from global (local didn't specify)
      assertEquals(cfg.pi.provider, "anthropic")
      // model and thinking from local
      assertEquals(cfg.pi.model, "sonnet")
      assertEquals(cfg.pi.thinking, "high")
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

Deno.test("loadConfig — parses optional postCheckout array", () => {
  withTempDir((dir) => {
    const yaml = `commands:
  - label: Test
    prompt: Run tests
pi:
  provider: anthropic
postCheckout:
  - npm install
  - npm run build
`
    fs.writeFileSync(path.join(dir, ".pr-updater.yaml"), yaml)
    const origCwd = Deno.cwd()
    Deno.chdir(dir)
    try {
      withoutHomeConfig(() => {
        const cfg = loadConfig()
        assertEquals(cfg.postCheckout, ["npm install", "npm run build"])
      })
    } finally {
      Deno.chdir(origCwd)
    }
  })
})

Deno.test("loadConfig — postCheckout is optional", () => {
  withTempDir((dir) => {
    const yaml = `commands:
  - label: Test
    prompt: Run tests
pi:
  provider: anthropic
`
    fs.writeFileSync(path.join(dir, ".pr-updater.yaml"), yaml)
    const origCwd = Deno.cwd()
    Deno.chdir(dir)
    try {
      withoutHomeConfig(() => {
        const cfg = loadConfig()
        assertEquals(cfg.postCheckout, undefined)
      })
    } finally {
      Deno.chdir(origCwd)
    }
  })
})

Deno.test("loadConfig — errors on YAML parse failure", () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, ".pr-updater.yaml"), "{{invalid")
    Deno.env.set("HOME", dir)
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
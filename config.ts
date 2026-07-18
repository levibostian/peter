import { parse } from "@std/yaml"
import type { Config } from "./types.ts"

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}

/** Load config from repo root `.pr-updater.yaml`, fallback to `~/.pr-updater.yaml`. */
export function loadConfig(): Config {
  const paths = ["./.pr-updater.yaml", `${Deno.env.get("HOME") ?? "~"}/.pr-updater.yaml`]

  let raw: string | undefined
  let usedPath: string | undefined
  for (const p of paths) {
    try {
      raw = Deno.readTextFileSync(p)
      usedPath = p
      break
    } catch {
      // not found at this path
    }
  }

  if (raw === undefined) {
    throw new ConfigError("no .pr-updater.yaml found in repo root or home directory")
  }

  let parsed: Record<string, unknown>
  try {
    parsed = parse(raw) as Record<string, unknown>
  } catch (err) {
    throw new ConfigError(`failed to parse ${usedPath}: ${err}`)
  }

  if (!parsed || typeof parsed !== "object") {
    throw new ConfigError(`${usedPath} must be a YAML object`)
  }

  const commands = parsed["commands"]
  if (!Array.isArray(commands)) {
    throw new ConfigError(`${usedPath} must contain a "commands" array`)
  }

  const pi = parsed["pi"] as Record<string, unknown> | undefined
  if (!pi || typeof pi !== "object") {
    throw new ConfigError(`${usedPath} must contain a "pi" object with at least "provider"`)
  }
  if (typeof pi["provider"] !== "string" || pi["provider"] === "") {
    throw new ConfigError(`${usedPath} pi.provider is required and must be a non-empty string`)
  }

  // Validate each command
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i] as Record<string, unknown>
    if (!cmd || typeof cmd !== "object") {
      throw new ConfigError(`${usedPath} commands[${i}] must be an object`)
    }
    if (typeof cmd["label"] !== "string" || cmd["label"] === "") {
      throw new ConfigError(`${usedPath} commands[${i}].label is required`)
    }
    if (typeof cmd["prompt"] !== "string" || cmd["prompt"] === "") {
      throw new ConfigError(`${usedPath} commands[${i}].prompt is required`)
    }
  }

  return {
    commands: commands as Config["commands"],
    pi: {
      provider: pi["provider"] as string,
      model: typeof pi["model"] === "string" ? pi["model"] : undefined,
      thinking: typeof pi["thinking"] === "string" ? pi["thinking"] : undefined,
    },
  }
}
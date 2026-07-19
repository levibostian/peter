import { parse } from "@std/yaml"
import type { Config, Command } from "./types.ts"

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}

function loadYaml(path: string): Record<string, unknown> | undefined {
  try {
    return parse(Deno.readTextFileSync(path)) as Record<string, unknown>
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return undefined
    throw new ConfigError(`failed to parse ${path}: ${err}`)
  }
}

function validate(parsed: Record<string, unknown>, source: string): Config {
  const commands = parsed["commands"]
  if (!Array.isArray(commands)) {
    throw new ConfigError(`${source} must contain a "commands" array`)
  }
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i] as Record<string, unknown>
    if (!cmd || typeof cmd !== "object") throw new ConfigError(`${source} commands[${i}] must be an object`)
    if (typeof cmd["label"] !== "string" || cmd["label"] === "") throw new ConfigError(`${source} commands[${i}].label is required`)
    if (typeof cmd["prompt"] !== "string" || cmd["prompt"] === "") throw new ConfigError(`${source} commands[${i}].prompt is required`)
  }

  const pi = parsed["pi"] as Record<string, unknown> | undefined
  if (!pi || typeof pi !== "object") throw new ConfigError(`${source} must contain a "pi" object with at least "provider"`)
  if (typeof pi["provider"] !== "string" || pi["provider"] === "") throw new ConfigError(`${source} pi.provider is required`)

  const rawPostCheckout = parsed["postCheckout"]
  if (rawPostCheckout !== undefined) {
    if (!Array.isArray(rawPostCheckout)) throw new ConfigError(`${source} postCheckout must be an array of strings`)
    for (let i = 0; i < rawPostCheckout.length; i++) {
      if (typeof rawPostCheckout[i] !== "string" || rawPostCheckout[i] === "") {
        throw new ConfigError(`${source} postCheckout[${i}] must be a non-empty string`)
      }
    }
  }

  return {
    commands: commands as Command[],
    pi: {
      provider: pi["provider"] as string,
      model: typeof pi["model"] === "string" ? pi["model"] : undefined,
      thinking: typeof pi["thinking"] === "string" ? pi["thinking"] : undefined,
    },
    postCheckout: rawPostCheckout as string[] | undefined,
  }
}

/** Load global config from ~/.pr-updater.yaml, local from ./.pr-updater.yaml, merge them.
 *
 * Arrays (commands, postCheckout) concatenate: global first, local second.
 * Pi fields merge individually: local can override model/thinking without
 * repeating provider.
 * Other top-level keys: local overrides global.
 *
 * At least one file must exist.
 */
export function loadConfig(): Config {
  const home = Deno.env.get("HOME") ?? "~"
  const globalRaw = loadYaml(`${home}/.pr-updater.yaml`)
  const localRaw = loadYaml("./.pr-updater.yaml")

  if (!globalRaw && !localRaw) {
    throw new ConfigError("no .pr-updater.yaml found in repo root or home directory")
  }

  const merged: Record<string, unknown> = {
    ...(globalRaw ?? {}),
    ...(localRaw ?? {}),
  }

  // arrays concatenate (global first, local second)
  if (globalRaw?.commands && localRaw?.commands) {
    merged.commands = [...(globalRaw.commands as unknown[]), ...(localRaw.commands as unknown[])]
  }
  if (globalRaw?.postCheckout && localRaw?.postCheckout) {
    merged.postCheckout = [
      ...(globalRaw.postCheckout as unknown[]),
      ...(localRaw.postCheckout as unknown[]),
    ]
  }

  // pi fields merge individually
  const gPi = (globalRaw?.pi ?? undefined) as Record<string, unknown> | undefined
  const lPi = (localRaw?.pi ?? undefined) as Record<string, unknown> | undefined
  if (gPi || lPi) {
    merged.pi = { ...(gPi ?? {}), ...(lPi ?? {}) }
  }

  const sources = [globalRaw && `${home}/.pr-updater.yaml`, localRaw && "./.pr-updater.yaml"]
    .filter(Boolean)
    .join(" + ")
  return validate(merged, sources)
}
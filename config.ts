import { parse } from "@std/yaml"
import type { Config } from "./types.ts"

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

/** Load global config from ~/.peter.yaml, local from ./.peter.yaml, merge them.
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
  const globalRaw = loadYaml(`${home}/.peter.yaml`)
  const localRaw = loadYaml("./.peter.yaml")
  if (!globalRaw && !localRaw) throw new ConfigError("no .peter.yaml found in repo root or home directory")

  const merged: Record<string, unknown> = { ...(globalRaw ?? {}), ...(localRaw ?? {}) }

  // Arrays concatenate: global first, local second
  if (globalRaw?.commands && localRaw?.commands) {
    merged.commands = [...(globalRaw.commands as unknown[]), ...(localRaw.commands as unknown[])]
  }
  if (globalRaw?.postCheckout && localRaw?.postCheckout) {
    merged.postCheckout = [...(globalRaw.postCheckout as unknown[]), ...(localRaw.postCheckout as unknown[])]
  }

  // Pi fields merge individually so local can override model/thinking without repeating provider
  merged.pi = { ...((globalRaw?.pi ?? {}) as Record<string, unknown>), ...((localRaw?.pi ?? {}) as Record<string, unknown>) }

  return merged as unknown as Config
}
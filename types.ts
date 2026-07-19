/** GitHub PR status check state (summary from statusCheckRollup). */
export type CheckState = "SUCCESS" | "FAILURE" | "PENDING" | "EXPECTED" | "ERROR"

/** GitHub PR review decision. */
export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null

/** GitHub PR mergeability state. */
export type MergeableState = "MERGEABLE" | "CONFLICTING" | "UNKNOWN"

/** Minimal PR as returned by `gh pr list`. */
export interface PR {
  number: number
  headRefName: string
  baseRefName: string
  headRefOid: string
  statusCheckRollup: CheckRun[]
  reviews: Review[]
  mergeable: MergeableState
  url?: string
}

export interface CheckRun {
  name: string
  state: string
}

export interface Review {
  state: ReviewDecision
  author: string
}

/** User-configured command from YAML. */
export interface Command {
  label: string
  prompt: string
}

/** Pi agent config section. */
export interface PiConfig {
  provider?: string
  model?: string
  thinking?: string
}

/** Top-level config file shape. */
export interface Config {
  commands: Command[]
  pi: PiConfig
  /** Shell commands to run after a successful git checkout (optional). */
  postCheckout?: string[]
}
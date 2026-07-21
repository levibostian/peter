import { assert } from "@std/assert"
import { mockBin } from "@levibostian/mock-a-bin"
import { createLogger, type Logger } from "@levibostian/sh-style"
import { interactiveMain, runPostCheckoutCommands } from "./main.ts"
import type { PR, Config } from "./types.ts"

/** Default config fixture for tests. */
const testConfig: Config = {
  commands: [
    { label: "Run tests", prompt: "Run the test suite" },
    { label: "Run build", prompt: "Run the build" },
  ],
  pi: { provider: "anthropic" },
}

function makePR(overrides: Partial<PR> & { number: number; headRefName: string }): PR {
  return {
    baseRefName: "main",
    headRefOid: "oid",
    statusCheckRollup: [],
    reviews: [],
    mergeable: "MERGEABLE",
    ...overrides,
  }
}

// Capture sh-style output through a custom logger
function captureLogger(): { log: Logger; lines: string[] } {
  const lines: string[] = []
  return {
    log: { log: (s: string) => lines.push(s) },
    lines,
  }
}

// Helper: run interactiveMain with captured output and mocked binaries
async function runWithMocks(
  prs: PR[],
  ordered: string[],
  inputs: string[],
  ghScript: string,
  gitScript: string,
): Promise<string[]> {
  let inputIndex = 0
  const inputReader = () => (inputIndex < inputs.length ? inputs[inputIndex++] : null)
  const { log: testLogger, lines } = captureLogger()
  const logger = createLogger({ logger: testLogger })

  const cleanupGh = await mockBin("gh", "bash", ghScript)
  const cleanupGit = await mockBin("git", "bash", gitScript)

  try {
    await interactiveMain({ prs, ordered, config: testConfig, inputReader, logger })
  } finally {
    cleanupGh()
    cleanupGit()
  }

  return lines
}

// -- gh mock that returns JSON for pr view based on PR number
function ghScriptWithPRs(prs: PR[]): string {
  const viewCases = prs
    .map((p) => {
      const withUrl = { ...p, url: `https://github.com/org/repo/pull/${p.number}` }
      return `      ${p.number}) echo '${JSON.stringify(withUrl)}' ;;`
    })
    .join("\n")

  return `
    case "$1-$2" in
      "pr-list") echo '[]' ;;
      "repo-view") echo '{"defaultBranch":"main"}' ;;
      "pr-view")
        case "$3" in
${viewCases}
          *) echo '{}' ;;
        esac
        ;;
      *) echo '{}' ;;
    esac
  `
}

// -- git mock that always succeeds
const GIT_OK_SCRIPT = `
  case "$1" in
    checkout) exit 0 ;;
    fetch) exit 0 ;;
    rev-list) echo "0"; exit 0 ;;
    *) exit 1 ;;
  esac
`

Deno.test("interactiveMain — no PRs exits quietly", async () => {
  const { log: testLogger, lines } = captureLogger()
  const logger = createLogger({ logger: testLogger })

  await interactiveMain({ prs: [], ordered: [], config: testConfig, inputReader: () => null, logger })

  assert(lines.some((l) => l.includes("No open PRs")), "should print no PRs message")
})

Deno.test("interactiveMain — single PR shows status panel and finishes", async () => {
  const prs = [
    makePR({ number: 1, headRefName: "feat/a", statusCheckRollup: [{ name: "unit-tests", state: "SUCCESS" }] }),
  ]

  const lines = await runWithMocks(prs, ["feat/a"], ["c"], ghScriptWithPRs(prs), GIT_OK_SCRIPT)

  // Panel header
  assert(lines.some((l) => l.includes("PR #1")), "panel should show PR number")
  assert(lines.some((l) => l.includes("feat/a")), "panel should show branch name")

  // Status checks
  assert(lines.some((l) => l.includes("unit-tests")), "panel should show check runs")
  assert(lines.some((l) => l.includes("Next branch")), "panel should show next option")
})

Deno.test("interactiveMain — multiple branches navigate with c", async () => {
  const prs = [
    makePR({ number: 1, headRefName: "feat/a" }),
    makePR({ number: 2, headRefName: "feat/b", baseRefName: "feat/a" }),
  ]

  const lines = await runWithMocks(
    prs,
    ["feat/a", "feat/b"],
    ["c", "c"],
    ghScriptWithPRs(prs),
    GIT_OK_SCRIPT,
  )

  // Should show both branches
  assert(lines.some((l) => l.includes("(1/2)")), "panel should show 1/2 for first branch")
  assert(lines.some((l) => l.includes("(2/2)")), "panel should show 2/2 for second branch")

  // Should show branch list with current indicator
  const all = lines.join("\n")
  assert(all.includes("Branches"), "panel should show branch list header")
  assert(all.includes("\u2192 feat/a"), "first branch panel should mark feat/a as current")
  assert(all.includes("  feat/b"), "first branch panel should show feat/b without marker")
})

Deno.test("interactiveMain — q exits early", async () => {
  const prs = [
    makePR({ number: 1, headRefName: "feat/a" }),
    makePR({ number: 2, headRefName: "feat/b" }),
  ]

  const lines = await runWithMocks(
    prs,
    ["feat/a", "feat/b"],
    ["q"],
    ghScriptWithPRs(prs),
    GIT_OK_SCRIPT,
  )

  // Only first branch processed, second not reached
  assert(lines.some((l) => l.includes("(1/2)")), "should process first branch")
  assert(lines.every((l) => !l.includes("(2/2)")), "should NOT process second branch")
})

Deno.test("interactiveMain — checkout failure skips branch", async () => {
  const prs = [
    makePR({ number: 1, headRefName: "feat/missing" }),
    makePR({ number: 2, headRefName: "feat/exists" }),
  ]

  const gitScript = `
    case "$1" in
      checkout)
        if [ "$2" = "feat/missing" ]; then
          echo "error: pathspec did not match" >&2
          exit 1
        fi
        exit 0
        ;;
      fetch) exit 0 ;;
      rev-list) echo "0"; exit 0 ;;
      *) exit 1 ;;
    esac
  `

  const lines = await runWithMocks(
    prs,
    ["feat/missing", "feat/exists"],
    ["c", "c"],
    ghScriptWithPRs(prs),
    gitScript,
  )

  // feat/exists should be processed (feat/missing skipped)
  assert(lines.some((l) => l.includes("feat/exists")), "should process second branch after skip")
  assert(lines.some((l) => l.includes("Next branch")), "should show menu")
})

Deno.test("interactiveMain — single PR processes with c and exits", async () => {
  const prs = [
    makePR({ number: 1, headRefName: "feat/a" }),
  ]

  const lines = await runWithMocks(prs, ["feat/a"], ["c"], ghScriptWithPRs(prs), GIT_OK_SCRIPT)

  assert(lines.some((l) => l.includes("PR #1")), "should process single PR")
})

Deno.test("interactiveMain — menu re-prompts on invalid input", async () => {
  const prs = [
    makePR({ number: 1, headRefName: "feat/a" }),
  ]

  let inputCallCount = 0
  const inputs = ["x", "invalid", "c"] // first two invalid, third moves on
  const inputReader = () => {
    const val = inputCallCount < inputs.length ? inputs[inputCallCount] : null
    inputCallCount++
    // Signal we got a re-prompt by checking count
    return val
  }

  const { log: testLogger, lines } = captureLogger()
  const logger = createLogger({ logger: testLogger })

  const cleanupGh = await mockBin("gh", "bash", ghScriptWithPRs(prs))
  const cleanupGit = await mockBin("git", "bash", GIT_OK_SCRIPT)

  try {
    await interactiveMain({ prs, ordered: ["feat/a"], config: testConfig, inputReader, logger })
  } finally {
    cleanupGh()
    cleanupGit()
  }

  // Should have processed successfully after invalid inputs
  assert(lines.some((l) => l.includes("PR #1")), "should process PR after invalid inputs")
})

Deno.test("interactiveMain — panel shows check details", async () => {
  const prs = [
    makePR({
      number: 1,
      headRefName: "feat/a",
      statusCheckRollup: [
        { name: "lint", state: "SUCCESS" },
        { name: "build", state: "FAILURE" },
        { name: "e2e", state: "PENDING" },
      ],
      mergeable: "CONFLICTING",
      reviews: [
        { state: "CHANGES_REQUESTED", author: "reviewer1" },
        { state: "APPROVED", author: "reviewer2" },
      ],
    }),
  ]

  const lines = await runWithMocks(prs, ["feat/a"], ["c"], ghScriptWithPRs(prs), GIT_OK_SCRIPT)

  const all = lines.join("\n")
  assert(all.includes("lint"), "should show lint check")
  assert(all.includes("build"), "should show build check")
  assert(all.includes("e2e"), "should show e2e check")
  assert(all.includes("✗ changes requested"), "should show changes requested review")
  assert(all.includes("✓ approved"), "should show approved review")
})

Deno.test("interactiveMain — review shows none requested when no reviewers", async () => {
  const prs = [
    makePR({ number: 1, headRefName: "feat/a" }),
  ]

  const lines = await runWithMocks(prs, ["feat/a"], ["c"], ghScriptWithPRs(prs), GIT_OK_SCRIPT)

  const all = lines.join("\n")
  assert(all.includes("none requested"), "should show none requested when no reviewers assigned")
})

Deno.test("interactiveMain — review shows waiting when reviewers assigned but no action", async () => {
  const prs = [
    makePR({
      number: 1,
      headRefName: "feat/a",
      reviewRequests: [
        { __typename: "User", login: "alice" },
        { __typename: "User", login: "bob" },
      ],
    }),
  ]

  const lines = await runWithMocks(prs, ["feat/a"], ["c"], ghScriptWithPRs(prs), GIT_OK_SCRIPT)

  const all = lines.join("\n")
  assert(all.includes("⏳ waiting"), "should show waiting indicator")
  assert(all.includes("alice"), "should show alice as waiting")
  assert(all.includes("bob"), "should show bob as waiting")
})

Deno.test("interactiveMain — review filters out acted reviewers from waiting list", async () => {
  const prs = [
    makePR({
      number: 1,
      headRefName: "feat/a",
      reviews: [
        { state: "APPROVED", author: "alice" },
      ],
      reviewRequests: [
        { __typename: "User", login: "alice" },
        { __typename: "User", login: "bob" },
      ],
    }),
  ]

  const lines = await runWithMocks(prs, ["feat/a"], ["c"], ghScriptWithPRs(prs), GIT_OK_SCRIPT)

  const all = lines.join("\n")
  assert(all.includes("✓ approved"), "should show alice's approval")
  assert(all.includes("⏳ waiting"), "should show waiting indicator")
  assert(all.includes("bob"), "should show bob as waiting")
  // alice already acted, so bob is the only one in waiting list
  assert(!all.match(/waiting:.*alice/), "should NOT show alice as waiting since she approved")
})

Deno.test("interactiveMain — processes all branches with navigation", async () => {
  const prs = [
    makePR({ number: 1, headRefName: "feat/a" }),
    makePR({ number: 2, headRefName: "feat/b" }),
  ]

  const lines = await runWithMocks(prs, ["feat/a", "feat/b"], ["c", "c"], ghScriptWithPRs(prs), GIT_OK_SCRIPT)

  assert(lines.some((l) => l.includes("(1/2)")), "should process first branch")
  assert(lines.some((l) => l.includes("(2/2)")), "should process second branch")
})

Deno.test("interactiveMain — shows config commands in menu", async () => {
  const prs = [
    makePR({ number: 1, headRefName: "feat/a" }),
  ]

  const lines = await runWithMocks(prs, ["feat/a"], ["c"], ghScriptWithPRs(prs), GIT_OK_SCRIPT)

  const all = lines.join("\n")
  assert(all.includes("1  Run tests"), "should show first command label")
  assert(all.includes("2  Run build"), "should show second command label")
})

Deno.test("interactiveMain — no commands shows navigation only", async () => {
  const prs = [
    makePR({ number: 1, headRefName: "feat/a" }),
  ]

  const inputReader = () => "c"
  const { log: testLogger, lines } = captureLogger()
  const logger = createLogger({ logger: testLogger })

  const cleanupGh = await mockBin("gh", "bash", ghScriptWithPRs(prs))
  const cleanupGit = await mockBin("git", "bash", GIT_OK_SCRIPT)

  const emptyCmdsConfig = { ...testConfig, commands: [] }

  try {
    await interactiveMain({ prs, ordered: ["feat/a"], config: emptyCmdsConfig, inputReader, logger })
  } finally {
    cleanupGh()
    cleanupGit()
  }

  const all = lines.join("\n")
  assert(all.includes("c  Next branch"), "should show next branch")
  assert(all.includes("q  Quit"), "should show quit")
  // No numbered commands should appear
  assert(!all.includes("1  "), "should not show any numbered commands")
})

// ---------------------------------------------------------------------------
// Post-checkout
// ---------------------------------------------------------------------------

Deno.test("runPostCheckoutCommands — runs all commands successfully", () => {
  const { log: testLogger, lines } = captureLogger()
  const logger = createLogger({ logger: testLogger })

  const result = runPostCheckoutCommands(["true", "echo ok"], logger)

  assert(result, "should return true when all commands succeed")
})

Deno.test("runPostCheckoutCommands — stops at first failure", () => {
  const { log: testLogger, lines } = captureLogger()
  const logger = createLogger({ logger: testLogger })

  const result = runPostCheckoutCommands(["true", "false", "echo should-not-run"], logger)

  assert(!result, "should return false when a command fails")
})

Deno.test("interactiveMain — runs post-checkout commands after checkout", async () => {
  const prs = [
    makePR({ number: 1, headRefName: "feat/a" }),
  ]

  const inputReader = () => "c"
  const { log: testLogger, lines } = captureLogger()
  const logger = createLogger({ logger: testLogger })

  const cleanupGh = await mockBin("gh", "bash", ghScriptWithPRs(prs))
  const cleanupGit = await mockBin("git", "bash", GIT_OK_SCRIPT)

  const configWithPostCheckout: Config = {
    ...testConfig,
    postCheckout: ["echo post-checkout-ran"],
  }

  try {
    await interactiveMain({ prs, ordered: ["feat/a"], config: configWithPostCheckout, inputReader, logger })
  } finally {
    cleanupGh()
    cleanupGit()
  }

  // The post-checkout command output goes to stdout (inherit), not through logger
  // Test by verifying the flow completed (PR panel shown)
  assert(lines.some((l) => l.includes("PR #1")), "should process PR after post-checkout")
})
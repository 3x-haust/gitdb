import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import packageJson from "../package.json" with { type: "json" }

describe("benchmark evaluator", () => {
  it("defines a benchmark evaluator script for JSON evidence output", () => {
    // Given: package metadata is the user-facing command surface.
    const scripts = packageJson.scripts

    // When: the evaluator command is inspected.
    const command = scripts["benchmark:evaluate"]

    // Then: it builds first and asks the benchmark runner for JSON output.
    expect(command).toBe("corepack pnpm build && node scripts/benchmark.mjs --json")
  })

  it("supports JSON output and evidence file targets in the benchmark runner", async () => {
    // Given: the benchmark runner is the evaluator used by package scripts.
    const script = await readFile("scripts/benchmark.mjs", "utf8")

    // When: the runner implementation is inspected.
    const hasJsonFlag = script.includes("--json")
    const hasOutputTarget = script.includes("GITDB_BENCH_OUTPUT")

    // Then: evaluator runs can produce machine-readable evidence.
    expect(hasJsonFlag).toBe(true)
    expect(hasOutputTarget).toBe(true)
  })

  it("defines a benchmark comparison command for the website evidence file", () => {
    // Given: the public site should be generated from reproducible benchmark evidence.
    const scripts = packageJson.scripts

    // When: package scripts are inspected.
    const command = scripts["benchmark:compare"]

    // Then: the comparison command writes both machine and Markdown summaries.
    expect(command).toContain("GITDB_BENCH_OUTPUT=.gitdb/bench-current.json")
    expect(command).toContain("scripts/benchmark-compare.mjs")
    expect(command).toContain("--output site/benchmark.json")
    expect(command).toContain("--markdown site/benchmark.md")
  })
})

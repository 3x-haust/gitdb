import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

type BenchmarkEvidence = {
  readonly comparisons?: readonly unknown[]
  readonly scenarios: readonly unknown[]
}

describe("website", () => {
  it("publishes benchmark evidence consumed by the static site", async () => {
    const parsed: unknown = JSON.parse(await readFile("site/benchmark.json", "utf8"))

    expect(isBenchmarkEvidence(parsed)).toBe(true)
    if (!isBenchmarkEvidence(parsed)) {
      throw new Error("invalid benchmark evidence")
    }
    expect(parsed.scenarios.length).toBeGreaterThan(0)
  })

  it("deploys the site directory through GitHub Pages", async () => {
    const workflow = await readFile(".github/workflows/pages.yml", "utf8")
    const index = await readFile("site/index.html", "utf8")
    const app = await readFile("site/app.js", "utf8")

    expect(workflow).toContain("path: site")
    expect(app).toContain("./benchmark.json")
    expect(index).toContain("GitHub Repo + DB Runtime")
    expect(index).toContain("A runtime, log, and snapshot system over repository storage")
    expect(index).toContain("./assets/runtime-map.svg")
  })
})

function isBenchmarkEvidence(value: unknown): value is BenchmarkEvidence {
  return (
    typeof value === "object" &&
    value !== null &&
    "scenarios" in value &&
    Array.isArray(value.scenarios)
  )
}

import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

type BenchmarkEvidence = {
  readonly comparisons: readonly unknown[]
  readonly headline: string
}

describe("website", () => {
  it("publishes benchmark evidence consumed by the static site", async () => {
    const parsed: unknown = JSON.parse(await readFile("site/benchmark.json", "utf8"))

    expect(isBenchmarkEvidence(parsed)).toBe(true)
    if (!isBenchmarkEvidence(parsed)) {
      throw new Error("invalid benchmark evidence")
    }
    expect(parsed.comparisons.length).toBeGreaterThan(0)
    expect(parsed.headline).toContain("Local plaintext")
  })

  it("deploys the site directory through GitHub Pages", async () => {
    const workflow = await readFile(".github/workflows/pages.yml", "utf8")
    const index = await readFile("site/index.html", "utf8")
    const app = await readFile("site/app.js", "utf8")

    expect(workflow).toContain("path: site")
    expect(app).toContain("./benchmark.json")
    expect(index).toContain("A database runtime that treats a GitHub repo as durable storage")
    expect(index).toContain("GitDB is not a database file uploaded to GitHub")
    expect(index).toContain("./assets/runtime-map.svg")
  })
})

function isBenchmarkEvidence(value: unknown): value is BenchmarkEvidence {
  return (
    typeof value === "object" &&
    value !== null &&
    "comparisons" in value &&
    Array.isArray(value.comparisons) &&
    "headline" in value &&
    typeof value.headline === "string"
  )
}

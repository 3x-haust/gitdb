import { rm } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { runQuickstart } from "../examples/quickstart.js"

describe("quickstart example", () => {
  it("runs a PostgreSQL client join through GitDB facade", async () => {
    // Given: the packaged quickstart example starts its own encrypted GitDB store.
    const result = await runQuickstart()

    // When: the example completes its SQL scenario.
    await rm(result.storageRoot, { force: true, recursive: true })

    // Then: a normal PostgreSQL client observed joined rows from GitDB.
    expect(result.databaseUrl).toContain("postgresql://token@127.0.0.1:")
    expect(result.rows).toEqual([
      { person: "Ada", team: "Runtime" },
      { person: "Lin", team: "Storage" },
    ])
  })
})

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { GitDbEngine } from "../src/sql/engine.js"
import { LocalPlaintextStore } from "../src/storage/local-plaintext-store.js"

describe("plaintext store", () => {
  const roots: string[] = []

  afterEach(async () => {
    // Given: plaintext scenarios may create temporary stores.
    const pending = roots.splice(0, roots.length)

    // When: the scenario ends.
    await Promise.all(pending.map((root) => rm(root, { force: true, recursive: true })))

    // Then: no plaintext demo store leaks into the next test.
    expect(roots).toHaveLength(0)
  })

  it("writes readable JSON mutation logs when encryption is disabled", async () => {
    // Given: a plaintext GitDB store for public demo inspection.
    const root = await mkdtemp(join(tmpdir(), "gitdb-plain-"))
    roots.push(root)
    const engine = await GitDbEngine.open({ store: new LocalPlaintextStore({ root }) })

    // When: SQL mutations are executed through the engine.
    await engine.execute("CREATE TABLE teams (id STRING, name STRING)")
    await engine.execute("INSERT INTO teams VALUES ('t1', 'Storage')")

    // Then: public demo files contain readable SQL rather than encrypted payloads.
    const manifest = await readFile(join(root, "gitdb/v1/manifest.json"), "utf8")
    const mutation = await readFile(join(root, "gitdb/v1/log/00000000000000000002.json"), "utf8")
    expect(manifest).toContain("00000000000000000002")
    expect(mutation).toContain("INSERT INTO teams")
    expect(mutation).toContain("Storage")
  })
})

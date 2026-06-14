import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { GitDbEngine } from "../src/sql/engine.js"
import { LocalPlaintextStore } from "../src/storage/local-plaintext-store.js"
import type { VisibleDatabaseSnapshot } from "../src/types.js"

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

  it("writes table snapshots that can be edited like public GitHub data", async () => {
    // Given: a plaintext GitDB store used for public data inspection.
    const root = await mkdtemp(join(tmpdir(), "gitdb-visible-"))
    roots.push(root)
    const store = new LocalPlaintextStore({ root })
    const first = await GitDbEngine.open({ store })

    // When: a table is created and later edited through the visible snapshot file.
    await first.execute("CREATE TABLE people (id STRING, name STRING)")
    await first.execute("INSERT INTO people VALUES ('p1', 'Lin')")
    const schemaPath = join(root, "gitdb/v1/people/schema.json")
    const dataPath = join(root, "gitdb/v1/people/data.json")
    const visibleSchema = await readFile(schemaPath, "utf8")
    const visibleData = await readFile(dataPath, "utf8")
    await writeFile(dataPath, visibleData.replace('"Lin"', '"Ada"'), "utf8")
    const second = await GitDbEngine.open({ store })
    const result = await second.execute("SELECT name FROM people WHERE id = 'p1'")

    // Then: the visible table file is human-readable and drives the reopened DB state.
    expect(visibleSchema).toContain('"columns"')
    expect(visibleData).not.toContain('"columns"')
    expect(visibleData).not.toContain('"people"')
    expect(visibleData).toContain('"Lin"')
    expect(result.rows).toEqual([{ name: "Ada" }])
  })

  it("replays logs when visible snapshot checkpoint is stale", async () => {
    // Given: a plaintext store with a current visible snapshot and later unsnapshotted log entries.
    const root = await mkdtemp(join(tmpdir(), "gitdb-stale-snapshot-"))
    roots.push(root)
    const first = await GitDbEngine.open({
      snapshotPolicy: { mode: "interval", mutations: 100 },
      store: new LocalPlaintextStore({ root }),
    })
    await first.execute("CREATE TABLE events (id STRING, label STRING)")
    await first.execute("INSERT INTO events VALUES ('e1', 'snapshotted')")
    await first.execute("INSERT INTO events VALUES ('e2', 'log-only')")

    // When: the engine reopens after the manifest moved beyond the visible snapshot checkpoint.
    const second = await GitDbEngine.open({ store: new LocalPlaintextStore({ root }) })
    const result = await second.execute("SELECT label FROM events ORDER BY id")

    // Then: it ignores the stale visible files and replays the mutation log.
    expect(result.rows).toEqual([{ label: "snapshotted" }, { label: "log-only" }])
  })

  it("replays logs when visible snapshot has no checkpoint", async () => {
    // Given: a manifest-backed store with old dashboard files but no snapshot checkpoint.
    const root = await mkdtemp(join(tmpdir(), "gitdb-uncheckpointed-snapshot-"))
    roots.push(root)
    const engine = await GitDbEngine.open({
      snapshotPolicy: { mode: "interval", mutations: 100 },
      store: new LocalPlaintextStore({ root }),
    })
    await engine.execute("CREATE TABLE events (id STRING, label STRING)")
    await engine.execute("INSERT INTO events VALUES ('e1', 'dashboard-only')")
    await engine.execute("INSERT INTO events VALUES ('e2', 'log-only')")
    await mkdir(join(root, "gitdb/v1/events"), { recursive: true })
    await writeFile(
      join(root, "gitdb/v1/events/schema.json"),
      '{ "name": "events", "columns": ["id", "label"] }',
      "utf8",
    )
    await writeFile(
      join(root, "gitdb/v1/events/data.json"),
      '[{ "id": "e1", "label": "dashboard-only" }]',
      "utf8",
    )

    // When: the engine reopens after seeing uncheckpointed visible files.
    const reopened = await GitDbEngine.open({ store: new LocalPlaintextStore({ root }) })
    const result = await reopened.execute("SELECT label FROM events ORDER BY id")

    // Then: manifest/log replay wins over the uncheckpointed dashboard snapshot.
    expect(result.rows).toEqual([{ label: "dashboard-only" }, { label: "log-only" }])
  })

  it("writes visible snapshot checkpoint after table files", async () => {
    // Given: a table path that will fail because it is already a file.
    const root = await mkdtemp(join(tmpdir(), "gitdb-snapshot-order-"))
    roots.push(root)
    const store = new LocalPlaintextStore({ root })
    await mkdir(join(root, "gitdb/v1"), { recursive: true })
    await writeFile(join(root, "gitdb/v1/events"), "not a directory", "utf8")

    // When: the visible snapshot write fails before table contents are complete.
    await expect(
      store.writeVisibleSnapshot({
        sequence: 1,
        tables: [{ columns: ["id"], name: "events", rows: [{ id: "e1" }] }],
      }),
    ).rejects.toThrow()

    // Then: the advanced checkpoint is not left behind.
    await expect(readFile(join(root, "gitdb/v1/snapshot.json"), "utf8")).rejects.toThrow()
  })

  it("throttles visible snapshot writes for local plaintext speed", async () => {
    // Given: a plaintext store that counts visible snapshot writes.
    const root = await mkdtemp(join(tmpdir(), "gitdb-snapshot-policy-"))
    roots.push(root)
    const store = new CountingPlaintextStore({ root })
    const engine = await GitDbEngine.open({
      snapshotPolicy: { mode: "interval", mutations: 100 },
      store,
    })

    // When: many local mutations run against the same table.
    await engine.execute("CREATE TABLE events (id STRING, label STRING)")
    for (let index = 0; index < 250; index += 1) {
      await engine.execute(`INSERT INTO events VALUES ('e${index}', 'event ${index}')`)
    }

    // Then: visible dashboard snapshots are checkpointed instead of rewritten per row.
    expect(store.snapshotWrites).toBeLessThanOrEqual(3)
  })
})

class CountingPlaintextStore extends LocalPlaintextStore {
  snapshotWrites = 0

  override async writeVisibleSnapshot(snapshot: VisibleDatabaseSnapshot): Promise<void> {
    this.snapshotWrites += 1
    await super.writeVisibleSnapshot(snapshot)
  }
}

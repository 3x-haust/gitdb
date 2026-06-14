import { mkdtemp, readdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createAesGcmCipher } from "../src/crypto/aes-gcm.js"
import { GitDbEngine } from "../src/sql/engine.js"
import { LocalEncryptedStore } from "../src/storage/local-encrypted-store.js"
import { LocalPlaintextStore } from "../src/storage/local-plaintext-store.js"
import type { GitDbStore } from "../src/storage/store.js"
import type {
  GitDbManifest,
  PersistedMutation,
  SegmentId,
  VisibleDatabaseSnapshot,
} from "../src/types.js"

describe("GitDbEngine", () => {
  it("executes join and aggregate queries while persisting encrypted GitDB segments", async () => {
    // Given: a fresh encrypted file-backed GitDB store, not a SQLite database file.
    const root = await mkdtemp(join(tmpdir(), "gitdb-engine-"))
    const key = Buffer.alloc(32, 7).toString("base64url")
    const store = new LocalEncryptedStore({ root, cipher: createAesGcmCipher(key) })
    const engine = await GitDbEngine.open({ store })

    // When: schema and rows are written, then queried with advanced SQL.
    await engine.execute("CREATE TABLE users (id STRING, name STRING, org_id STRING)")
    await engine.execute("CREATE TABLE orgs (id STRING, name STRING)")
    await engine.execute("INSERT INTO orgs VALUES ('o1', 'Core')")
    await engine.execute("INSERT INTO users VALUES ('u1', 'Ada', 'o1')")
    await engine.execute("INSERT INTO users VALUES ('u2', 'Grace', 'o1')")
    const joined = await engine.execute(
      "SELECT users.name AS user_name, orgs.name AS org_name FROM users JOIN orgs ON users.org_id = orgs.id ORDER BY users.name",
    )
    const aggregate = await engine.execute(
      "SELECT org_id, COUNT(*) AS members FROM users GROUP BY org_id",
    )

    // Then: the SQL engine handles joins/aggregates and the stored segment is opaque.
    expect(joined.rows).toEqual([
      { org_name: "Core", user_name: "Ada" },
      { org_name: "Core", user_name: "Grace" },
    ])
    expect(aggregate.rows).toEqual([{ members: 2, org_id: "o1" }])
    const manifest = await readFile(join(root, "gitdb", "v1", "manifest.enc"), "utf8")
    const log = await readFile(join(root, "gitdb", "v1", "log", "00000000000000000005.enc"), "utf8")
    expect(manifest).not.toContain("users")
    expect(log).not.toContain("Ada")
  })

  it("replays encrypted mutation logs when a new engine opens", async () => {
    // Given: an engine that has committed SQL mutations into encrypted segments.
    const root = await mkdtemp(join(tmpdir(), "gitdb-replay-"))
    const key = Buffer.alloc(32, 9).toString("base64url")
    const store = new LocalEncryptedStore({ root, cipher: createAesGcmCipher(key) })
    const first = await GitDbEngine.open({ store })
    await first.execute("CREATE TABLE events (id STRING, label STRING)")
    await first.execute("INSERT INTO events VALUES ('e1', 'release')")

    // When: a new engine opens against the same GitDB storage.
    const second = await GitDbEngine.open({ store })
    const result = await second.execute("SELECT label FROM events WHERE id = 'e1'")

    // Then: state is rebuilt from GitDB files, not process memory.
    expect(result.rows).toEqual([{ label: "release" }])
  })

  it("commits transactions atomically and rolls back failed statements without log drift", async () => {
    // Given: a table with one committed row and a durable encrypted mutation log.
    const root = await mkdtemp(join(tmpdir(), "gitdb-transaction-"))
    const key = Buffer.alloc(32, 11).toString("base64url")
    const store = new LocalEncryptedStore({ root, cipher: createAesGcmCipher(key) })
    const engine = await GitDbEngine.open({ store })
    await engine.execute("CREATE TABLE accounts (id STRING, balance INT)")
    await engine.execute("INSERT INTO accounts VALUES ('a1', 10)")

    // When: one transaction succeeds and a later transaction fails midway.
    await engine.transaction(async (transaction) => {
      await transaction.execute("INSERT INTO accounts VALUES ('a2', 20)")
      await transaction.execute("INSERT INTO accounts VALUES ('a3', 30)")
    })
    const logAfterCommit = await readdir(join(root, "gitdb", "v1", "log"))
    await expect(
      engine.transaction(async (transaction) => {
        await transaction.execute("INSERT INTO accounts VALUES ('a4', 40)")
        await transaction.execute("THIS IS NOT SQL")
      }),
    ).rejects.toThrow("SQL failed")

    // Then: the failed transaction is not visible and did not append partial WAL segments.
    const logAfterRollback = await readdir(join(root, "gitdb", "v1", "log"))
    const rows = await engine.execute("SELECT id, balance FROM accounts ORDER BY id")
    expect(rows.rows).toEqual([
      { balance: 10, id: "a1" },
      { balance: 20, id: "a2" },
      { balance: 30, id: "a3" },
    ])
    expect(logAfterRollback).toHaveLength(logAfterCommit.length)
  })

  it("does not publish orphan segments after a manifest write failure", async () => {
    // Given: a plaintext store that fails the next manifest write after appending a segment.
    const root = await mkdtemp(join(tmpdir(), "gitdb-manifest-failure-"))
    const store = new FailingManifestStore(new LocalPlaintextStore({ root }))
    const engine = await GitDbEngine.open({
      snapshotPolicy: { mode: "interval", mutations: 100 },
      store,
    })
    await engine.execute("CREATE TABLE accounts (id STRING, balance INT)")
    await engine.execute("INSERT INTO accounts VALUES ('a1', 10)")

    // When: persistence fails after a transaction append, then a later write succeeds.
    store.failNextManifestWrite()
    await expect(
      engine.transaction(async (transaction) => {
        await transaction.execute("INSERT INTO accounts VALUES ('a2', 20)")
      }),
    ).rejects.toThrow("manifest failed")
    await engine.execute("INSERT INTO accounts VALUES ('a3', 30)")
    const reopened = await GitDbEngine.open({ store: new LocalPlaintextStore({ root }) })
    const rows = await reopened.execute("SELECT id, balance FROM accounts ORDER BY id")

    // Then: the failed orphan segment is not pulled into a later manifest.
    expect(rows.rows).toEqual([
      { balance: 10, id: "a1" },
      { balance: 30, id: "a3" },
    ])
  })

  it("restores committed state when a single-statement manifest write fails", async () => {
    // Given: a plaintext store that fails manifest persistence after appending a segment.
    const root = await mkdtemp(join(tmpdir(), "gitdb-fast-manifest-failure-"))
    const store = new FailingManifestStore(new LocalPlaintextStore({ root }))
    const engine = await GitDbEngine.open({
      snapshotPolicy: { mode: "interval", mutations: 100 },
      store,
    })
    await engine.execute("CREATE TABLE accounts (id STRING, balance INT)")
    await engine.execute("INSERT INTO accounts VALUES ('a1', 10)")

    // When: the single-statement fast path fails after mutating memory.
    store.failNextManifestWrite()
    await expect(engine.execute("INSERT INTO accounts VALUES ('a2', 20)")).rejects.toThrow(
      "manifest failed",
    )
    const liveRows = await engine.execute("SELECT id, balance FROM accounts ORDER BY id")
    const reopened = await GitDbEngine.open({ store: new LocalPlaintextStore({ root }) })
    const reopenedRows = await reopened.execute("SELECT id, balance FROM accounts ORDER BY id")

    // Then: live memory and reopened storage both reflect only committed manifest state.
    expect(liveRows.rows).toEqual([{ balance: 10, id: "a1" }])
    expect(reopenedRows.rows).toEqual([{ balance: 10, id: "a1" }])
  })

  it("keeps committed mutations successful when visible snapshot refresh fails", async () => {
    // Given: a plaintext store whose derived visible snapshot can fail independently.
    const root = await mkdtemp(join(tmpdir(), "gitdb-snapshot-failure-"))
    const store = new FailingSnapshotStore(new LocalPlaintextStore({ root }))
    const engine = await GitDbEngine.open({ store })
    await engine.execute("CREATE TABLE accounts (id STRING, balance INT)")

    // When: the manifest/log commit succeeds but the post-commit checkpoint write fails.
    store.failNextSnapshotWrite()
    await expect(engine.execute("INSERT INTO accounts VALUES ('a1', 10)")).resolves.toMatchObject({
      rowCount: 1,
    })
    const liveRows = await engine.execute("SELECT id, balance FROM accounts")
    const reopened = await GitDbEngine.open({ store: new LocalPlaintextStore({ root }) })
    const replayedRows = await reopened.execute("SELECT id, balance FROM accounts")

    // Then: the committed row remains visible and recoverable from the mutation log.
    expect(engine.getLastVisibleSnapshotError()).toBeInstanceOf(Error)
    expect(liveRows.rows).toEqual([{ balance: 10, id: "a1" }])
    expect(replayedRows.rows).toEqual([{ balance: 10, id: "a1" }])
  })
})

class FailingManifestStore implements GitDbStore {
  readonly #delegate: GitDbStore
  #failNextManifestWrite = false

  constructor(delegate: GitDbStore) {
    this.#delegate = delegate
  }

  failNextManifestWrite(): void {
    this.#failNextManifestWrite = true
  }

  async readManifest(): Promise<GitDbManifest | null> {
    return await this.#delegate.readManifest()
  }

  async writeManifest(manifest: GitDbManifest): Promise<void> {
    if (this.#failNextManifestWrite) {
      this.#failNextManifestWrite = false
      throw new Error("manifest failed")
    }
    await this.#delegate.writeManifest(manifest)
  }

  async appendMutation(mutation: PersistedMutation): Promise<SegmentId> {
    return await this.#delegate.appendMutation(mutation)
  }

  async readMutations(segments: readonly SegmentId[]): Promise<readonly PersistedMutation[]> {
    return await this.#delegate.readMutations(segments)
  }

  async readVisibleSnapshot(): Promise<VisibleDatabaseSnapshot | null> {
    return (await this.#delegate.readVisibleSnapshot?.()) ?? null
  }

  async writeVisibleSnapshot(snapshot: VisibleDatabaseSnapshot): Promise<void> {
    await this.#delegate.writeVisibleSnapshot?.(snapshot)
  }
}

class FailingSnapshotStore implements GitDbStore {
  readonly #delegate: GitDbStore
  #failNextSnapshotWrite = false

  constructor(delegate: GitDbStore) {
    this.#delegate = delegate
  }

  failNextSnapshotWrite(): void {
    this.#failNextSnapshotWrite = true
  }

  async readManifest(): Promise<GitDbManifest | null> {
    return await this.#delegate.readManifest()
  }

  async writeManifest(manifest: GitDbManifest): Promise<void> {
    await this.#delegate.writeManifest(manifest)
  }

  async appendMutation(mutation: PersistedMutation): Promise<SegmentId> {
    return await this.#delegate.appendMutation(mutation)
  }

  async readMutations(segments: readonly SegmentId[]): Promise<readonly PersistedMutation[]> {
    return await this.#delegate.readMutations(segments)
  }

  async readVisibleSnapshot(): Promise<VisibleDatabaseSnapshot | null> {
    return (await this.#delegate.readVisibleSnapshot?.()) ?? null
  }

  async writeVisibleSnapshot(snapshot: VisibleDatabaseSnapshot): Promise<void> {
    if (this.#failNextSnapshotWrite) {
      this.#failNextSnapshotWrite = false
      throw new Error("snapshot failed")
    }
    await this.#delegate.writeVisibleSnapshot?.(snapshot)
  }
}

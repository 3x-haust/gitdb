import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createAesGcmCipher } from "../src/crypto/aes-gcm.js"
import { GitDbEngine } from "../src/sql/engine.js"
import { LocalEncryptedStore } from "../src/storage/local-encrypted-store.js"

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
})

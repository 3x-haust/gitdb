import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "pg"
import { afterEach, describe, expect, it } from "vitest"
import { createAesGcmCipher } from "../src/crypto/aes-gcm.js"
import { createGitDbServer } from "../src/protocol/postgres-server.js"
import { GitDbEngine } from "../src/sql/engine.js"
import { LocalEncryptedStore } from "../src/storage/local-encrypted-store.js"

describe("PostgreSQL facade", () => {
  const servers: { readonly close: () => Promise<void> }[] = []

  afterEach(async () => {
    // Given: test servers may have been started by a scenario.
    const pending = servers.splice(0, servers.length)

    // When: the scenario ends.
    await Promise.all(pending.map((server) => server.close()))

    // Then: no server leaks into the next E2E run.
    expect(servers).toHaveLength(0)
  })

  it("accepts a pg client and executes join queries through postgres://", async () => {
    // Given: a GitDB PostgreSQL-compatible server backed by encrypted GitDB files.
    const root = await mkdtemp(join(tmpdir(), "gitdb-pg-"))
    const key = Buffer.alloc(32, 3).toString("base64url")
    const store = new LocalEncryptedStore({ root, cipher: createAesGcmCipher(key) })
    const engine = await GitDbEngine.open({ store })
    const server = await createGitDbServer({ engine, host: "127.0.0.1", port: 0 })
    servers.push(server)
    const client = new Client({
      connectionString: `postgresql://127.0.0.1:${server.port}/main`,
    })

    // When: an ordinary Postgres client drives schema, writes, and a relation join.
    await client.connect()
    await client.query("CREATE TABLE teams (id STRING, name STRING)")
    await client.query("CREATE TABLE people (id STRING, name STRING, team_id STRING)")
    await client.query("INSERT INTO teams VALUES ('t1', 'Storage')")
    await client.query("INSERT INTO people VALUES ('p1', 'Lin', 't1')")
    const result = await client.query(
      "SELECT people.name AS person, teams.name AS team FROM people JOIN teams ON people.team_id = teams.id",
    )
    await client.end()

    // Then: the ORM-facing surface behaves like a PostgreSQL connection.
    expect(result.rows).toEqual([{ person: "Lin", team: "Storage" }])
  })
})

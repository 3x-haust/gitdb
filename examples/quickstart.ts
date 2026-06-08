import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "pg"
import { createAesGcmCipher } from "../src/crypto/aes-gcm.js"
import { createGitDbServer } from "../src/protocol/postgres-server.js"
import { GitDbEngine } from "../src/sql/engine.js"
import { LocalEncryptedStore } from "../src/storage/local-encrypted-store.js"

type JoinedTeamRow = {
  readonly person: string
  readonly team: string
}

export type QuickstartResult = {
  readonly databaseUrl: string
  readonly rows: readonly JoinedTeamRow[]
  readonly storageRoot: string
}

export async function runQuickstart(): Promise<QuickstartResult> {
  const storageRoot = await mkdtemp(join(tmpdir(), "gitdb-example-"))
  const key = Buffer.alloc(32, 7).toString("base64url")
  const store = new LocalEncryptedStore({
    cipher: createAesGcmCipher(key),
    root: storageRoot,
  })
  const engine = await GitDbEngine.open({ store })
  const server = await createGitDbServer({ engine, host: "127.0.0.1", port: 0 })
  const databaseUrl = `postgresql://token@127.0.0.1:${server.port}/main`
  const client = new Client({ connectionString: databaseUrl })
  let connected = false

  try {
    await client.connect()
    connected = true

    await client.query("CREATE TABLE teams (id STRING, name STRING)")
    await client.query("CREATE TABLE people (id STRING, name STRING, team_id STRING)")
    await client.query("INSERT INTO teams VALUES ('t1', 'Storage')")
    await client.query("INSERT INTO teams VALUES ('t2', 'Runtime')")
    await client.query("INSERT INTO people VALUES ('p1', 'Lin', 't1')")
    await client.query("INSERT INTO people VALUES ('p2', 'Ada', 't2')")

    const result = await client.query<JoinedTeamRow>(
      [
        "SELECT people.name AS person, teams.name AS team",
        "FROM people",
        "JOIN teams ON people.team_id = teams.id",
        "ORDER BY people.name",
      ].join(" "),
    )

    return {
      databaseUrl,
      rows: result.rows,
      storageRoot,
    }
  } finally {
    if (connected) {
      await client.end()
    }
    await server.close()
  }
}

async function main(): Promise<void> {
  const result = await runQuickstart()
  process.stdout.write(`GitDB facade: ${result.databaseUrl}\n`)
  process.stdout.write(`Encrypted local store: ${result.storageRoot}\n`)
  process.stdout.write(`${JSON.stringify(result.rows, null, 2)}\n`)
  await rm(result.storageRoot, { force: true, recursive: true })
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error: unknown) => {
    if (error instanceof Error) {
      process.stderr.write(`${error.stack ?? error.message}\n`)
      process.exitCode = 1
      return
    }
    process.stderr.write(`${String(error)}\n`)
    process.exitCode = 1
  })
}

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { performance } from "node:perf_hooks"
import { Client } from "pg"
import { createAesGcmCipher } from "../dist/src/crypto/aes-gcm.js"
import { GitHubPlaintextStore } from "../dist/src/github/github-plaintext-store.js"
import { createGitDbServer } from "../dist/src/protocol/postgres-server.js"
import { GitDbEngine } from "../dist/src/sql/engine.js"
import { LocalEncryptedStore } from "../dist/src/storage/local-encrypted-store.js"
import { LocalPlaintextStore } from "../dist/src/storage/local-plaintext-store.js"

const args = new Set(process.argv.slice(2))
const rows = numberEnv("GITDB_BENCH_ROWS", 250)
const githubRows = numberEnv("GITDB_BENCH_GITHUB_ROWS", 8)
const results = []

results.push(
  await benchEngine({
    label: "local plaintext throttled visible snapshots",
    rows,
    snapshotPolicy: { mode: "interval", mutations: 100 },
    store: (root) => new LocalPlaintextStore({ root }),
  }),
)
results.push(
  await benchEngine({
    label: "local encrypted mutation log",
    rows,
    store: (root) =>
      new LocalEncryptedStore({
        cipher: createAesGcmCipher(Buffer.alloc(32, 7).toString("base64url")),
        root,
      }),
  }),
)
results.push(await benchPostgresFacade(rows))

if (args.has("--github")) {
  results.push(await benchGitHubPlaintext(githubRows))
}

if (process.env.GITDB_BENCH_OUTPUT !== undefined) {
  await writeJson(process.env.GITDB_BENCH_OUTPUT, results)
}

process.stdout.write(
  args.has("--json") ? `${JSON.stringify(results, null, 2)}\n` : formatMarkdown(results),
)

async function benchEngine(options) {
  const root = await mkdtemp(join(tmpdir(), "gitdb-bench-"))
  try {
    const engine = await GitDbEngine.open({
      snapshotPolicy: options.snapshotPolicy,
      store: options.store(root),
    })
    await createTables(engine)
    const writeMs = await time(async () => {
      await insertRows(engine, options.rows)
    })
    const joinMs = await time(async () => {
      await assertJoin(engine, options.rows)
    })
    const reopenMs = await time(async () => {
      const reopened = await GitDbEngine.open({
        snapshotPolicy: options.snapshotPolicy,
        store: options.store(root),
      })
      await assertJoin(reopened, options.rows)
    })
    return result(options.label, options.rows, writeMs, joinMs, reopenMs)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

async function benchPostgresFacade(rowCount) {
  const root = await mkdtemp(join(tmpdir(), "gitdb-pg-bench-"))
  const store = new LocalEncryptedStore({
    cipher: createAesGcmCipher(Buffer.alloc(32, 9).toString("base64url")),
    root,
  })
  const engine = await GitDbEngine.open({ store })
  const server = await createGitDbServer({ engine, host: "127.0.0.1", port: 0 })
  const client = new Client({
    connectionString: `postgresql://127.0.0.1:${server.port}/main`,
  })
  try {
    await client.connect()
    await createTables(client)
    const writeMs = await time(async () => {
      await insertRows(client, rowCount)
    })
    const joinMs = await time(async () => {
      await assertJoin(client, rowCount)
    })
    return result("postgres facade over local encrypted", rowCount, writeMs, joinMs, 0)
  } finally {
    await client.end()
    await server.close()
    await rm(root, { force: true, recursive: true })
  }
}

async function benchGitHubPlaintext(rowCount) {
  const owner = requiredEnv("GITDB_GITHUB_OWNER")
  const repo = requiredEnv("GITDB_GITHUB_REPO")
  const token = requiredEnv("GITDB_GITHUB_TOKEN")
  const branch = process.env.GITDB_GITHUB_BRANCH ?? "main"
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-")
  const prefix = process.env.GITDB_BENCH_GITHUB_PREFIX ?? `gitdb/bench-${stamp}`
  const store = new GitHubPlaintextStore({ branch, owner, prefix, repo, token })
  const engine = await GitDbEngine.open({ store })
  await createTables(engine)
  const writeMs = await time(async () => {
    await insertRows(engine, rowCount)
  })
  const joinMs = await time(async () => {
    await assertJoin(engine, rowCount)
  })
  const reopenMs = await time(async () => {
    const reopened = await GitDbEngine.open({ store })
    await assertJoin(reopened, rowCount)
  })
  return result(`github plaintext contents api (${prefix})`, rowCount, writeMs, joinMs, reopenMs)
}

async function createTables(target) {
  await execute(target, "CREATE TABLE teams (id STRING, name STRING)")
  await execute(target, "CREATE TABLE people (id STRING, name STRING, team_id STRING)")
  for (let i = 0; i < 10; i += 1) {
    await execute(target, `INSERT INTO teams VALUES ('t${i}', 'Team ${i}')`)
  }
}

async function insertRows(target, rowCount) {
  for (let i = 0; i < rowCount; i += 1) {
    await execute(target, `INSERT INTO people VALUES ('p${i}', 'Person ${i}', 't${i % 10}')`)
  }
}

async function assertJoin(target, rowCount) {
  const response = await execute(
    target,
    "SELECT people.name AS person, teams.name AS team FROM people JOIN teams ON people.team_id = teams.id ORDER BY people.name",
  )
  const count = Array.isArray(response.rows) ? response.rows.length : response.rowCount
  if (count !== rowCount) {
    throw new Error(`expected ${rowCount} joined rows, got ${count}`)
  }
}

async function execute(target, sql) {
  if ("execute" in target) {
    return await target.execute(sql)
  }
  return await target.query(sql)
}

async function time(operation) {
  const startedAt = performance.now()
  await operation()
  return performance.now() - startedAt
}

function result(label, rowCount, writeMs, joinMs, reopenMs) {
  return {
    joinMs,
    label,
    reopenMs,
    rows: rowCount,
    writesPerSecond: (rowCount / writeMs) * 1000,
    writeMs,
  }
}

function formatMarkdown(items) {
  const lines = [
    "| Scenario | Rows | Write ms | Writes/s | Join ms | Reopen ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ]
  for (const item of items) {
    lines.push(
      `| ${item.label} | ${item.rows} | ${fixed(item.writeMs)} | ${fixed(item.writesPerSecond)} | ${fixed(item.joinMs)} | ${fixed(item.reopenMs)} |`,
    )
  }
  return `${lines.join("\n")}\n`
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function fixed(value) {
  return value.toFixed(2)
}

function numberEnv(name, fallback) {
  const value = process.env[name]
  if (value === undefined || value.trim().length === 0) {
    return fallback
  }
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function requiredEnv(name) {
  const value = process.env[name]
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`)
  }
  return value
}

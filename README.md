# GitDB

English | [한국어](docs/README.ko.md) | [Website](https://3x-haust.github.io/gitdb/)

GitDB is a GitHub-backed database runtime for project data. It keeps the hot path
local, persists mutations through a manifest-gated log, and uses a GitHub
repository as durable storage plus an audit trail.

```text
App code
  -> GitDB DataSource / Repository
  -> Local SQL engine + transaction queue
  -> Manifest, mutation log, visible snapshots
  -> GitHub repository for durable history
```

GitDB is not a single database file uploaded to a repo. The important parts are
the storage engine, transaction boundary, replayable log, snapshot model, and the
first-party API that lets apps use those pieces directly.

## Why GitDB

Use GitDB when you want:

- A database repository per project, for example `my-app-db`
- Local query execution without per-query network round-trips
- A TypeORM-style `DataSource` and repository API included in the package
- Public table snapshots that can be inspected from GitHub when plaintext mode is intentional
- Encrypted manifest and mutation logs for private data
- Auditable commits for agents, demos, content tools, config tools, and low-frequency app data

GitDB is still experimental. Do not use it for high-throughput OLTP, low-latency
distributed writers, or workloads that require mature secondary indexes today.

## Current Surface

| Area | Current behavior |
| --- | --- |
| App API | `createGitDbDataSource`, `defineEntity`, and typed repositories |
| SQL engine | `CREATE TABLE`, `INSERT`, `DELETE`, `SELECT`, joins, grouping, ordering, and aggregates |
| Storage | Local encrypted, local plaintext, GitHub encrypted, and GitHub plaintext stores |
| Durability | Manifest-gated mutation log replay with visible snapshot checkpoints |
| CLI | `gitdb keygen`, `gitdb query`, and `gitdb check` |
| Example | First-party local runtime example under `examples/local-runtime` |
| Package | npm-ready metadata, exports, bin, pack dry-run, and publish dry-run scripts |

## Repository Layout

Plaintext mode writes internal state plus human-readable snapshots:

```text
gitdb/v1/
  manifest.json
  people/
    schema.json
    data.json
  teams/
    schema.json
    data.json
  log/
    00000000000000000001.json
```

`schema.json` contains only schema:

```json
{
  "name": "people",
  "columns": ["id", "name", "team_id"]
}
```

`data.json` contains rows:

```json
[
  { "id": "p1", "name": "Lin", "team_id": "t1" },
  { "id": "p2", "name": "Ada", "team_id": "t2" }
]
```

Encrypted mode writes opaque files:

```text
gitdb/v1/
  manifest.enc
  log/
    00000000000000000001.enc
```

## Quick Start

Install and build:

```bash
corepack pnpm install
corepack pnpm build
```

Use the first-party repository API:

```ts
import { LocalPlaintextStore, createGitDbDataSource, defineEntity } from "@3xhaust/gitdb"

type Person = {
  readonly id: string
  readonly name: string
  readonly team_id: string
}

const PersonEntity = defineEntity<Person>({
  columns: { id: "STRING", name: "STRING", team_id: "STRING" },
  primaryKey: "id",
  tableName: "people",
})

const dataSource = await createGitDbDataSource({
  entities: [PersonEntity],
  store: new LocalPlaintextStore({ root: ".gitdb" }),
  synchronize: true,
})

const people = dataSource.getRepository(PersonEntity)
await people.save({ id: "p1", name: "Lin", team_id: "storage" })
const storagePeople = await people.find({ where: { team_id: "storage" } })
```

Run the bundled example:

```bash
corepack pnpm example
```

It builds the package, opens a local plaintext store, writes `teams` and
`people`, runs a join, reopens the store, and prints a JSON summary.

## CLI

Generate an encryption key:

```bash
node dist/src/cli/main.js keygen
```

Check the configured store:

```bash
GITDB_ENCRYPTION=off GITDB_ROOT=.gitdb node dist/src/cli/main.js check
```

Execute one SQL statement:

```bash
GITDB_ENCRYPTION=off GITDB_ROOT=.gitdb \
  node dist/src/cli/main.js query "CREATE TABLE people (id STRING, name STRING)"
```

## Environment Model

Local plaintext mode:

```env
GITDB_ENCRYPTION=off
GITDB_ROOT=.gitdb
```

Local encrypted mode:

```env
GITDB_ENCRYPTION=on
GITDB_KEY=generated-by-gitdb-keygen
GITDB_ROOT=.gitdb
```

GitHub-backed modes additionally use:

```env
GITDB_GITHUB_OWNER=3x-haust
GITDB_GITHUB_REPO=my-project-db
GITDB_GITHUB_BRANCH=main
GITDB_GITHUB_PREFIX=gitdb/v1
GITDB_GITHUB_TOKEN=github_token_with_contents_write_access
```

Leave `GITDB_GITHUB_TOKEN` blank for local-only development. Use
`GITDB_ENCRYPTION=off` only for intentional public demos where table names,
columns, and rows should be visible.

## Architecture

GitDB is split into four layers:

1. First-party API
   - Provides `DataSource`, `Repository`, `save`, `find`, `findOne`, `delete`,
     raw `query`, and explicit transaction access.
   - Keeps new apps directly on GitDB's runtime surface.

2. SQL engine
   - Owns schema, mutation execution, query execution, joins, grouping, ordering,
     and result rows.
   - Serializes local mutations before persistence.

3. Storage providers
   - Local encrypted store for development and private local data.
   - Local plaintext store for visible snapshots.
   - GitHub encrypted/plaintext stores for remote durability.

4. Audit and recovery model
   - Manifest state records the committed sequence.
   - Mutation logs are replayable on open.
   - Visible snapshots accelerate plaintext reopen paths.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for more detail.

## Benchmarks

Run local benchmarks:

```bash
corepack pnpm benchmark
```

Refresh website benchmark evidence:

```bash
GITDB_BENCH_ROWS=250 corepack pnpm benchmark:site
```

Compare the current runtime with the previous documented local run:

```bash
GITDB_BENCH_ROWS=250 corepack pnpm benchmark:compare
```

Latest measured run:

| Scenario | Rows | Write ms | Writes/s | Join ms | Reopen ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| local plaintext throttled visible snapshots | 250 | 146.75 | 1703.61 | 4.88 | 77.62 |
| local encrypted mutation log | 250 | 234.37 | 1066.70 | 1.18 | 78.31 |
| orm local plaintext | 250 | 5377.34 | 46.49 | 1.30 | 136.29 |

Interpretation: raw local execution is already usable for examples, demos, and
low-frequency project data. Repository `save()` is intentionally safer but much
slower today because every row is written through a small transaction. The next
performance work is storage-shaped: batch repository writes, add page-level
snapshots, add indexes, compact logs, and sync Git commits in batches.

See [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

## Security Model

Encrypted mode protects manifest and mutation log contents with AES-256-GCM.
Keys are never stored in the repository.

Public repositories can still reveal metadata:

- Commit time
- File count
- Approximate file size
- Write frequency

Mitigations include batching, padding, compaction, and opaque paths in future
storage versions.

## Current Limitations

- SQL support is intentionally limited to the subset GitDB currently executes.
- Repository `save()` is not optimized for bulk inserts yet.
- Multi-process writers are guarded by remote state, but this is not yet a
  high-concurrency OLTP database.
- GitHub Contents API mode is useful for demos and correctness testing, not
  production write throughput.
- Public plaintext mode is intentionally not private.

Unsupported SQL should fail explicitly instead of pretending to work.

## Commands

```bash
corepack pnpm check
corepack pnpm test
corepack pnpm build
corepack pnpm benchmark
corepack pnpm benchmark:evaluate
corepack pnpm pack:dry-run
corepack pnpm publish:dry-run
corepack pnpm example
```

## License

MIT

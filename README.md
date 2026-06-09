# GitDB

English | [한국어](docs/README.ko.md)

GitDB turns a GitHub repository into a project-scoped database.

It exposes a PostgreSQL-compatible local TCP endpoint, accepts SQL from tools
such as Prisma and `pg`, executes the query in GitDB's engine, and persists the
database into a dedicated GitHub repository. Public repositories can be used as
human-readable data dashboards or as encrypted object stores.

```text
Express / Prisma / pg
        |
        | postgresql://127.0.0.1:7432/main
        v
GitDB PostgreSQL facade
        |
        | in-memory SQL engine + manifest/log replay
        v
GitHub repository
```

GitDB is not SQLite-over-GitHub, and it does not upload `.db` files. The GitHub
repository is the durable database store.

## Why GitDB

GitHub already gives small teams commits, pull requests, history, branching,
review, public visibility, private repos, and access control. GitDB uses those
primitives for project data.

Use it when you want:

- A database repository per project, for example `my-app-db`
- SQL and ORM access without writing custom Prisma, TypeORM, Drizzle, or Kysely
  providers
- Public data that can be inspected and edited from GitHub's web UI
- Encrypted data in public or private repositories
- Auditable commits for agent memory, demos, content tools, config tools, and
  low-frequency app data

Do not use it when you need high-throughput OLTP, low-latency multi-writer
transactions, or full PostgreSQL compatibility today.

## Features

| Area | Current behavior |
| --- | --- |
| ORM access | PostgreSQL-style local endpoint, so existing PostgreSQL clients can connect |
| SQL | `CREATE TABLE`, `INSERT`, `DELETE`, `SELECT`, joins, grouping, ordering, aggregates, and common raw-query flows |
| GitHub storage | Dedicated repository per database, created on first write when permissions allow |
| Public plaintext mode | `table/schema.json` and `table/data.json` are visible and editable in GitHub |
| Encrypted mode | AES-256-GCM encrypted manifest and mutation log files |
| Local mode | No GitHub variables required; data stays under a local root directory |
| Example app | Express + Prisma API using GitDB through the PostgreSQL facade |
| Benchmarks | Local, facade, and GitHub Contents API benchmark commands included |

## Repository Layout

In plaintext public mode, GitDB writes both internal state and human-facing table
snapshots:

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

`data.json` contains only rows:

```json
[
  { "id": "p1", "name": "Lin", "team_id": "t1" },
  { "id": "p2", "name": "Ada", "team_id": "t2" }
]
```

That means a public database repository can be browsed like a lightweight
Firebase-style data console. Editing `data.json` in GitHub and committing the
change updates the visible table snapshot that GitDB restores on the next open.

In encrypted mode, GitDB writes opaque files:

```text
gitdb/v1/
  manifest.enc
  log/
    00000000000000000001.enc
```

## Quick Start

Install and build:

```bash
pnpm install
pnpm build
```

Run the local PostgreSQL facade with encrypted local storage:

```bash
export GITDB_KEY="$(node dist/src/cli/main.js keygen)"
pnpm start:facade
```

Connect with `psql`, `pg`, Prisma, or another PostgreSQL client:

```bash
psql postgresql://127.0.0.1:7432/main
```

Example SQL:

```sql
CREATE TABLE teams (id STRING, name STRING);
CREATE TABLE people (id STRING, name STRING, team_id STRING);

INSERT INTO teams VALUES ('t1', 'Storage');
INSERT INTO people VALUES ('p1', 'Lin', 't1');

SELECT people.name, teams.name AS team
FROM people
JOIN teams ON people.team_id = teams.id;
```

## Express + Prisma Example

The example is a real API shape: Express handles HTTP routes, Prisma talks to
GitDB through the PostgreSQL facade, and GitDB stores the data locally or in the
GitHub database repository configured by the example `.env`.

```bash
cp examples/express-prisma/.env.example examples/express-prisma/.env
pnpm example
```

In another terminal:

```bash
curl http://127.0.0.1:3090/health
curl -X POST http://127.0.0.1:3090/seed
curl http://127.0.0.1:3090/people
```

By default the example uses plaintext mode:

```env
GITDB_ENCRYPTION=off
GITDB_ROOT=.gitdb-example-public
GITDB_GITHUB_OWNER=3x-haust
GITDB_GITHUB_REPO=gitdb-example-db
GITDB_GITHUB_BRANCH=main
GITDB_GITHUB_PREFIX=gitdb/v1
GITDB_GITHUB_TOKEN=
API_PORT=3090
```

Leave `GITDB_GITHUB_TOKEN` empty to test against local files. Add a GitHub token
to write to the dedicated public database repository. The token needs Contents
read/write access to that database repository. If the repository does not exist,
the token also needs permission to create repositories for the owner.

## Environment Model

The root `.env` is for the GitDB facade process:

```env
GITDB_ENCRYPTION=on
GITDB_KEY=generated-by-gitdb-keygen
GITDB_ROOT=.gitdb
GITDB_HOST=0.0.0.0
GITDB_PORT=7432
```

Application examples keep their own `.env` files because application settings
and database-repository settings should not leak into the package root.

### Encryption

`GITDB_KEY` must be a base64url-encoded 32-byte key generated by GitDB:

```bash
node dist/src/cli/main.js keygen
```

Keep it outside Git. If the key changes, previously encrypted data cannot be
decrypted.

Use `GITDB_ENCRYPTION=off` only for intentional public demos where table names,
columns, and rows should be visible in GitHub.

### GitHub Storage

Set these variables in the process that runs the facade:

```bash
export GITDB_GITHUB_OWNER="3x-haust"
export GITDB_GITHUB_REPO="my-project-db"
export GITDB_GITHUB_BRANCH="main"
export GITDB_GITHUB_PREFIX="gitdb/v1"
export GITDB_GITHUB_TOKEN="github_pat_... or ghp_..."
gitdb serve
```

Recommended pattern:

- Source repo: `my-project`
- Database repo: `my-project-db`
- Public demo data: `GITDB_ENCRYPTION=off`
- Real public or private data: `GITDB_ENCRYPTION=on`

## Runtime And Trust Model

`gitdb serve` and a hosted GitDB endpoint are the same kind of runtime:
PostgreSQL facade, SQL engine, and GitHub sync. The important question is where
that runtime runs.

| Mode | Runtime location | Who can decrypt? | Best for |
| --- | --- | --- | --- |
| Self-hosted encrypted | Your app server, VPS, local machine, or private infra | Only the environment holding `GITDB_KEY` | Real app data, public encrypted repos, private repos |
| Hosted plaintext | GitDB hosted runtime such as `gitdb.3xhaust.dev` | Everyone can read the GitHub repo anyway | Public demos, public datasets, inspectable examples |
| Hosted encrypted | GitDB hosted runtime | The hosted runtime must receive/use the key | Managed convenience mode, not zero-knowledge |

If you want encrypted data where only your service can decrypt it, run GitDB
yourself:

```text
Your App -> your gitdb serve -> encrypted GitHub repo
```

Do not send `GITDB_KEY` to a hosted runtime unless you intentionally choose a
managed mode where that runtime is trusted to process plaintext query results.

## Architecture

GitDB is split into three layers:

1. PostgreSQL-compatible facade
   - Opens a local TCP endpoint.
   - Lets existing clients use a normal PostgreSQL connection string.
   - Avoids ORM-specific driver/provider work.

2. SQL engine
   - Owns schema, mutation execution, query execution, joins, grouping, and
     result rows.
   - Targets the PostgreSQL subset produced by common Node.js clients and ORM
     raw-query flows.

3. Storage providers
   - Local encrypted store for development and tests.
   - Local plaintext store for visible snapshots.
   - GitHub encrypted/plaintext stores for remote durability.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for more detail.

## Benchmarks

Run local benchmarks:

```bash
pnpm benchmark
```

Run the GitHub write benchmark:

```bash
GITDB_BENCH_GITHUB_ROWS=2 pnpm benchmark:github
```

Latest measured run:

| Scenario | Rows | Write ms | Writes/s | Join ms | Reopen ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| local plaintext visible snapshots | 250 | 1443.90 | 173.14 | 32.97 | 140.05 |
| local encrypted mutation log | 250 | 761.99 | 328.09 | 4.31 | 322.51 |
| postgres facade over local encrypted | 250 | 987.93 | 253.05 | 19.74 | 0.00 |
| github plaintext contents api | 2 | 14157.49 | 0.14 | 6.70 | 1812.62 |

Interpretation: local execution is already usable for experiments and
low-frequency workloads. Direct per-mutation GitHub Contents API writes are too
slow for the hot path. In the current implementation, live queries execute in an
in-memory SQL engine restored from a manifest, mutation log, or visible
snapshot. WAL, indexes, and batched Git commits are planned storage-engine work,
not current guarantees.

See [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

## Performance Roadmap

The next performance work is storage-shaped, not facade-shaped:

- Local WAL first: return success after local durable write in `fast` mode
- Batched Git commits: replace repeated Contents API writes with Git Database
  tree commits
- Snapshot throttling: refresh visible `data.json` on intervals or explicit
  sync, not every mutation
- Chunked table pages: avoid rewriting a whole table for one row change
- Local primary and secondary indexes: keep joins and filters off the GitHub hot
  path
- Manifest versions: skip unchanged table reads on cold start
- Strong mode: optionally block until the GitHub commit lands

## Security Model

Encrypted mode protects manifest and mutation log contents with AES-256-GCM.
Keys are never stored in the repository.

Public GitHub repositories can still reveal metadata:

- Commit time
- File count
- Approximate file size
- Write frequency

Mitigations include batching, padding, compaction, and opaque paths in future
storage versions.

## Current Limitations

- SQL support is intentionally limited to the subset GitDB currently executes.
- PostgreSQL catalog emulation is not complete.
- Multi-process writers are guarded by GitHub state, but this is not yet a
  high-concurrency OLTP database.
- GitHub Contents API mode is useful for demos and correctness testing, not
  production write throughput.
- Public plaintext mode is intentionally not private.

Unsupported SQL should fail explicitly instead of pretending to work.

## Commands

```bash
pnpm check
pnpm test
pnpm build
pnpm benchmark
pnpm start:facade
pnpm example
```

## Deployment

The deployable service is a NestJS HTTP control plane plus the
PostgreSQL-compatible facade in the same process:

```bash
docker build -t gitdb .
docker run -p 3000:3000 -p 7432:7432 --env-file .env gitdb
```

`pnpm start` runs the HTTP control plane. `pnpm start:facade` runs only the TCP
facade for local ORM testing.

The current public HTTP control plane is deployed at:

```text
https://gitdb.3xhaust.dev/health
```

`gitdb.3xhaust.dev` should be treated as a hosted GitDB runtime/control-plane
instance. It is useful for public plaintext workflows, demos, setup flows, and
future managed modes. For encrypted data where only your service may decrypt the
database, run `gitdb serve` in your own environment and keep `GITDB_KEY` there.

HTTP deployment does not automatically expose the TCP facade to external ORM
clients. For remote ORM access, run `gitdb serve` near the application or deploy
to an environment that exposes TCP port `7432`.

## License

MIT

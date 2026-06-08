# GitDB

GitDB is a GitHub-native database with a PostgreSQL-compatible facade.

Use a GitHub repository as the durable database for a project, connect from
existing ORMs with a normal `postgresql://` URL, and choose whether public data
is encrypted or directly inspectable in GitHub's web UI.

GitDB does not upload SQLite `.db` files and does not use SQLite as its storage
engine. It runs a PostgreSQL-compatible TCP facade, executes SQL in an embedded
engine, and persists GitDB manifests, logs, encrypted segments, and visible
table snapshots to GitHub.

## Why

GitHub is already where many small teams manage source, review changes, branch,
audit history, and collaborate. GitDB explores a simple idea: for project-scale
apps, can a repository also be the durable, reviewable data layer?

The answer is yes for human-readable public datasets, demos, agent state,
content tools, project metadata, and low-frequency app data. It is not a
replacement for high-throughput OLTP databases.

## Features

- PostgreSQL-compatible TCP endpoint: `postgresql://localhost:7432/main`
- ORM-friendly facade for Prisma, TypeORM, Drizzle, and Kysely PostgreSQL modes
- SQL support for `CREATE TABLE`, `INSERT`, `SELECT`, `JOIN`, `GROUP BY`,
  `ORDER BY`, and aggregate queries through the current engine
- One GitHub database repository per app or project
- Public plaintext mode with Firebase-style `table/schema.json` and
  `table/data.json`
- Encrypted mode for public or private repositories
- Local encrypted and plaintext stores for development and tests
- Public repository safe by default when `GITDB_KEY` is kept outside the repo

## What It Is Not

- Not SQLite-over-GitHub
- Not a `.db` file uploader
- Not a GitHub API call per query
- Not a replacement for Postgres, MySQL, or SQLite in high-write OLTP systems
- Not a PostgreSQL-compatible database engine yet; it implements the subset
  needed for current ORM experiments

## Quick Start

```bash
pnpm install
pnpm build
export GITDB_KEY="$(node dist/src/cli/main.js keygen)"
pnpm start
```

In another terminal:

```bash
psql postgresql://127.0.0.1:7432/main
```

Or use any PostgreSQL ORM config:

```text
DATABASE_URL=postgresql://127.0.0.1:7432/main
```

## Storage Layout

Encrypted mode stores opaque files:

```text
gitdb/v1/manifest.enc
gitdb/v1/log/00000000000000000001.enc
```

Plaintext mode stores both an internal mutation log and a human-facing table
view:

```text
gitdb/v1/manifest.json
gitdb/v1/people/schema.json
gitdb/v1/people/data.json
gitdb/v1/teams/schema.json
gitdb/v1/teams/data.json
gitdb/v1/log/00000000000000000001.json
```

`schema.json` contains table structure:

```json
{
  "columns": ["id", "name", "team_id"],
  "name": "people"
}
```

`data.json` contains only rows:

```json
[
  { "id": "p1", "name": "Lin", "team_id": "t1" },
  { "id": "p2", "name": "Ada", "team_id": "t2" }
]
```

You can edit `data.json` in GitHub, commit it, and the next GitDB process
opening that prefix will restore from the visible table snapshots.

## Facade Environment

The root `.env.example` is only for running the GitDB PostgreSQL facade itself.
It should not contain application or example database-repository settings.

```bash
cp .env.example .env
pnpm build
node dist/src/cli/main.js keygen
```

`GITDB_KEY` is not an arbitrary password. It must be a base64url-encoded
32-byte key. Use `gitdb keygen` or `node dist/src/cli/main.js keygen` and keep
that exact value outside Git. If the key changes, previously encrypted data
cannot be decrypted.

Set `GITDB_ENCRYPTION=off` only when you intentionally want plaintext demo
files in a public repository. In that mode `GITDB_KEY` is not required and
GitDB writes `manifest.json` plus log JSON files instead of encrypted `.enc`
files.

The root `.env.example` only includes:

```env
GITDB_ENCRYPTION=on
GITDB_KEY=generated-by-gitdb-keygen
GITDB_ROOT=.gitdb
GITDB_HOST=0.0.0.0
GITDB_PORT=7432
```

## GitHub Storage

Set GitHub storage variables in the process that runs the facade when you want
that facade to persist into a GitHub database repository:

```bash
export GITDB_KEY="$(node dist/src/cli/main.js keygen)"
export GITDB_GITHUB_OWNER="3x-haust"
export GITDB_GITHUB_REPO="my-project-db"
export GITDB_GITHUB_BRANCH="main"
export GITDB_GITHUB_TOKEN="github_pat_... or ghp_..."
gitdb serve
```

Without `GITDB_GITHUB_*`, GitDB uses `.gitdb/gitdb/v1` locally.

Use a dedicated repository as the database for each project. For example, an
app can live in `my-project` while its GitDB data lives in `my-project-db`.
That database repository can be public or private. If it is public, keep
`GITDB_ENCRYPTION=on` for real data, or use `GITDB_ENCRYPTION=off` only for
intentional plaintext demos.

`GITDB_GITHUB_TOKEN` can be either a fine-grained personal access token such as
`github_pat_...` or a classic token such as `ghp_...`. Prefer a fine-grained
token restricted to the target repository with read/write `Contents`
permission. The token is only for pushing encrypted GitDB objects; never commit
it to the repository.

If the target repository does not exist, GitDB creates it as a public database
repository on the first write. The token therefore needs repository creation
permission for the owner. If the owner is an organization, the token user must
be allowed to create repositories in that organization. For a fine-grained
token, also grant access to the dedicated database repository after it exists,
not only the source-code repository.

## Express + Prisma Example

This example shows the shape of a real API service. Express serves HTTP routes,
Prisma connects to GitDB through the PostgreSQL facade, and GitDB persists to
the dedicated database repository configured by `examples/express-prisma/.env`.
The example has its own environment file because app/database-repository
settings should not live in the root facade `.env`.

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

The example `.env` defaults to `GITDB_ENCRYPTION=off` so public GitHub storage
is human-readable for inspection. It points at the dedicated public database
repo `3x-haust/gitdb-example-db`, not this source-code repository. Add
`GITDB_GITHUB_TOKEN` to make it write there. Leave the token empty to run the
same API against local plaintext files under `.gitdb-example-public`.

For GitHub-backed example mode, GitDB creates public repo
`3x-haust/gitdb-example-db` if it does not exist. The token must be allowed to
create repositories under `3x-haust`; after the repo exists, it must be able to
write contents there. If startup fails while writing `gitdb/v1/manifest.json`,
the token probably cannot create or access that database repository, or the
branch name is wrong.

Because the example intentionally runs in plaintext mode, its `.env.example`
does not include `GITDB_KEY`.

## Benchmarks

Run:

```bash
pnpm benchmark
GITDB_BENCH_GITHUB_ROWS=4 pnpm benchmark:github
```

Latest local run:

| Scenario | Rows | Write ms | Writes/s | Join ms | Reopen ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| local plaintext visible snapshots | 250 | 1443.90 | 173.14 | 32.97 | 140.05 |
| local encrypted mutation log | 250 | 761.99 | 328.09 | 4.31 | 322.51 |
| postgres facade over local encrypted | 250 | 987.93 | 253.05 | 19.74 | 0.00 |
| github plaintext contents api | 2 | 14157.49 | 0.14 | 6.70 | 1812.62 |

See [docs/BENCHMARKS.md](docs/BENCHMARKS.md) for interpretation and the
performance plan.

The key result: local query/write performance is acceptable for experiments,
but direct per-mutation GitHub Contents API writes are too slow and can hit
transient GitHub 5xx responses under bursts. The production path is local WAL
plus batched Git commits.

## Security Model

For public repositories, keep encryption enabled and never commit `GITDB_KEY`.
GitDB encrypts manifest and mutation segments with AES-256-GCM. Logical names
are not required in GitHub paths; provider storage can use opaque HMAC paths as
the storage layer evolves.

Public GitHub can still reveal metadata such as commit timing, file count, and
approximate file size. Use batch writes, padding, and compaction for workloads
where metadata leakage matters.

## Performance Roadmap

- Local WAL first: return success after local durable write in `fast` mode
- Git Database tree commits: batch many file updates into one Git commit
- Snapshot throttling: do not rewrite visible `data.json` after every mutation
- Chunked rows/pages: avoid rewriting a whole table for one row change
- Local indexes: keep joins and filters off the GitHub hot path
- Manifest versions: skip unchanged tables on cold start
- Strong mode: block until GitHub commit for workflows that need remote
  durability before returning

## Prior Art

GitDB borrows README and product-shape lessons from projects around this space:

- [Dolt](https://github.com/dolthub/dolt): SQL database with Git-style version
  control, a crisp "Git for Data" positioning.
- [Supabase](https://github.com/supabase/supabase): Firebase-like developer
  experience built around Postgres and open-source components.
- [Nhost](https://github.com/nhost/nhost): open-source Firebase alternative
  with GraphQL and SQL in the first screen.
- [PocketBase](https://github.com/pocketbase/pocketbase): small, inspectable
  backend with database, realtime, auth, and admin UI.
- [Appwrite](https://github.com/appwrite/appwrite): all-in-one backend platform
  with clear product surface and self-hosting story.

## Release Commands

```bash
pnpm check
pnpm test
pnpm build
```

## Deployment

The service is a long-running HTTP control plane plus PostgreSQL-compatible TCP
facade. Build and run it with:

```bash
docker build -t gitdb .
docker run -p 3000:3000 -p 7432:7432 --env-file .env gitdb
```

`pnpm start` runs the deployable NestJS control plane and starts the PostgreSQL
facade in the same process. `pnpm start:facade` runs only the TCP facade for
local ORM testing.

The public control-plane deployment is available at
`https://gitdb.3xhaust.dev/health`. It reports the facade bind target and
storage mode. The `@3xhaust/deploy-cli` HTTP ingress exposes the control plane;
external ORM access to the TCP facade requires a deploy target that exposes TCP
port `7432`, or a local `gitdb serve` process pointed at the same GitHub-backed
repository.

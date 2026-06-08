# GitDB

GitDB is a GitHub-native encrypted database with a PostgreSQL-compatible facade.
It is designed so existing ORMs can connect with a normal `postgres://` URL while
GitHub stores encrypted database segments, manifests, and mutation logs.

GitDB does not upload SQLite `.db` files and does not use SQLite as its storage
engine. The SQL surface is served through a PostgreSQL-compatible TCP facade,
the execution layer supports advanced SQL through an embedded SQL engine, and
the durable storage layer writes encrypted GitDB files to GitHub.

## Features

- PostgreSQL-compatible TCP endpoint: `postgresql://token@localhost:7432/main`
- ORM-friendly facade for Prisma, TypeORM, Drizzle, and Kysely PostgreSQL modes
- SQL support for `CREATE TABLE`, `INSERT`, `SELECT`, `JOIN`, `GROUP BY`,
  `ORDER BY`, and aggregate queries through the current engine
- Encrypted manifest and mutation log segments
- GitHub Contents API durable store
- Local encrypted store for development and tests
- Public repository safe by default when `GITDB_KEY` is kept outside the repo

## Quick Start

```bash
pnpm install
pnpm build
export GITDB_KEY="$(node dist/src/cli/main.js keygen)"
pnpm start
```

In another terminal:

```bash
psql postgresql://token@127.0.0.1:7432/main
```

Or use any PostgreSQL ORM config:

```text
DATABASE_URL=postgresql://token@127.0.0.1:7432/main
```

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

In plaintext GitHub mode, GitDB writes Firebase-style table snapshots alongside
the internal mutation log. After seeding, the public database repo contains
files such as:

```text
gitdb/v1/people/schema.json
gitdb/v1/people/data.json
gitdb/v1/teams/schema.json
gitdb/v1/teams/data.json
gitdb/v1/log/00000000000000000001.json
```

The `data.json` files are the human-facing public data view. You can inspect
and edit them in GitHub's web UI, commit the change, and the next GitDB process
opening that prefix will restore from those visible table snapshots.

For GitHub-backed example mode, GitDB creates public repo
`3x-haust/gitdb-example-db` if it does not exist. The token must be allowed to
create repositories under `3x-haust`; after the repo exists, it must be able to
write contents there. If startup fails while writing `gitdb/v1/manifest.json`,
the token probably cannot create or access that database repository, or the
branch name is wrong.

Because the example intentionally runs in plaintext mode, its `.env.example`
does not include `GITDB_KEY`.

## Security Model

For public repositories, keep encryption enabled and never commit `GITDB_KEY`.
GitDB encrypts manifest and mutation segments with AES-256-GCM. Logical names
are not required in GitHub paths; provider storage can use opaque HMAC paths as
the storage layer evolves.

Public GitHub can still reveal metadata such as commit timing, file count, and
approximate file size. Use batch writes, padding, and compaction for workloads
where metadata leakage matters.

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

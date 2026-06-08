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

## GitHub Storage

Set these variables to persist encrypted GitDB files to a GitHub repository:

```bash
export GITDB_KEY="base64url-32-byte-key"
export GITDB_GITHUB_OWNER="3x-haust"
export GITDB_GITHUB_REPO="gitdb-data"
export GITDB_GITHUB_TOKEN="ghp_or_fine_grained_token"
export GITDB_GITHUB_BRANCH="main"
gitdb serve
```

Without `GITDB_GITHUB_*`, GitDB uses `.gitdb/gitdb/v1` locally.

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

The service is a long-running TCP server. Build and run it with:

```bash
docker build -t gitdb .
docker run -p 3000:3000 -p 7432:7432 --env-file .env gitdb
```

`pnpm start` runs the deployable NestJS control plane and starts the PostgreSQL
facade in the same process. `pnpm start:facade` runs only the TCP facade for
local ORM testing.

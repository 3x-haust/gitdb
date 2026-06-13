# Architecture

GitDB has five layers.

## First-Party ORM API

New applications can use GitDB directly through `createGitDbDataSource`,
`defineEntity`, and repository methods such as `save`, `find`, `findOne`, and
`delete`. This is intentionally closer to TypeORM's `DataSource` and repository
shape than to a PostgreSQL-only facade.

The ORM API still executes through the same local runtime and transaction
executor as raw SQL. It is a convenience surface over the storage engine, not a
separate persistence path.

## PostgreSQL Facade

`gitdb serve` starts a PostgreSQL-compatible TCP server. Existing ORMs keep their
normal PostgreSQL provider and point their connection string at GitDB.

The facade handles startup, simple queries, prepared parse/bind/execute flows,
row descriptions, data rows, and command completion messages.

## SQL Engine

The current engine uses `alasql` for advanced SQL execution, including joins,
grouping, ordering, and aggregates. PostgreSQL-flavored SQL is normalized before
execution so common ORM-generated SQL can run.

Unsupported PostgreSQL features return explicit errors instead of falling back
silently.

Mutations are serialized through a single-engine transaction queue. A
single-statement mutation uses the hot local database directly, then persists the
mutation segment and manifest. If persistence fails, the engine restores the last
committed manifest state before returning the error. Explicit multi-statement
transactions still run against an isolated in-memory database clone and swap the
live database only after all segments and the manifest persist successfully. The
manifest is updated in memory only after the durable manifest write succeeds, so
a later mutation cannot publish orphan segments from a failed transaction.

## Storage Engine

GitDB persists schema and data changes as mutation segments plus a manifest:

```text
gitdb/v1/manifest.json or manifest.enc
gitdb/v1/log/<sequence>.json or <sequence>.enc
```

On startup, the engine restores a visible snapshot when its checkpoint sequence
matches the manifest. Otherwise it reads the manifest and replays the mutation
log into the hot query engine. This avoids GitHub round-trips during query
execution.

Plaintext visible snapshots are dashboard artifacts and cold-start checkpoints.
They can be written every mutation for maximum visibility or throttled by
mutation interval for faster local workloads. Snapshot table files are written
before `snapshot.json`; the checkpoint is the final marker that lets the engine
trust a visible snapshot. Once a manifest has committed mutations, visible files
without a checkpoint are ignored and the mutation log is replayed instead.

## GitHub Provider

The GitHub provider uses the Repository Contents API to read and create/update
encrypted segment files. Existing file `sha` values are used for optimistic
concurrency when updating files.

GitHub is the durable sync layer. Query execution stays local for acceptable
latency.

Public deployments should write encrypted database objects to a branch that is
separate from the application branch. The current release uses `main` for source
code and `data` for encrypted `gitdb/v1` objects. This keeps public storage
opaque while avoiding auto-deploy loops from database writes.

## Deployment Boundary

`pnpm start` launches the HTTP control plane and the PostgreSQL-compatible TCP
facade in one process. HTTP deployments can verify readiness through `/` or
`/health`. ORM clients still need TCP access to the facade port. When the deploy
target only exposes HTTP ingress, run `gitdb serve` near the ORM process and use
GitHub as the shared encrypted durability layer.

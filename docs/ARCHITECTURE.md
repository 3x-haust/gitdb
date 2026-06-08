# Architecture

GitDB has four layers.

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

## Storage Engine

GitDB persists schema and data changes as encrypted mutation segments:

```text
gitdb/v1/manifest.enc
gitdb/v1/log/<sequence>.enc
```

On startup, the engine reads the manifest, decrypts the mutation log, and replays
it into the hot query engine. This avoids GitHub round-trips during query
execution.

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

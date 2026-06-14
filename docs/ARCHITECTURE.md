# GitDB Architecture

GitDB is a first-party database runtime that uses a GitHub repository as durable
storage and audit history. Applications use the GitDB API directly; query
execution and write ordering stay local.

## Layers

### First-Party API

`createGitDbDataSource` opens a runtime over a selected store. `defineEntity`
declares table metadata, and `GitDbRepository` provides `save`, `find`,
`findOne`, and `delete`.

The API intentionally mirrors familiar `DataSource` and repository shapes while
keeping callers close to GitDB's own transaction and storage model.

### SQL Engine

`GitDbEngine` owns local execution. It handles schema mutations, row mutations,
queries, joins, grouping, ordering, aggregate results, transaction execution, and
manifest updates.

Single-statement mutations are serialized through an internal queue. Explicit
multi-statement work uses `engine.transaction()`, runs on an isolated database
copy, and persists only after the callback succeeds.

### Storage Providers

GitDB stores committed state through the `GitDbStore` interface:

- `LocalEncryptedStore`
- `LocalPlaintextStore`
- `GitHubEncryptedStore`
- `GitHubPlaintextStore`

Stores persist the manifest and mutation log. Plaintext stores can also write
visible table snapshots for inspection and faster reopen paths.

### Recovery Boundary

The manifest sequence is the committed boundary. On open, GitDB restores a
matching visible snapshot when one exists; otherwise it replays log segments in
manifest order.

If persistence fails after a local mutation, the engine restores the previous
committed manifest state before returning the error.

## Transaction Model

GitDB currently provides a single-process write queue. It prevents in-process
write interleaving and makes commit order explicit.

The current model does not claim mature distributed concurrency. Multi-process
writers still need stronger remote locking or compare-and-swap semantics before
GitDB can be treated as a high-concurrency OLTP system.

## Snapshot Policy

Visible snapshots can be written on every mutation or at an interval:

```ts
await GitDbEngine.open({
  snapshotPolicy: { mode: "interval", mutations: 100 },
  store,
})
```

Interval snapshots reduce write amplification in plaintext mode. The mutation
log remains the source of truth between checkpoints.

## App Runtime Example

```ts
const Person = defineEntity({
  tableName: "people",
  primaryKey: "id",
  columns: { id: "STRING", name: "STRING", team_id: "STRING" },
})

const dataSource = await createGitDbDataSource({
  entities: [Person],
  store: new LocalPlaintextStore({ root: ".gitdb" }),
  synchronize: true,
})

await dataSource.getRepository(Person).save({
  id: "p1",
  name: "Lin",
  team_id: "storage",
})
```

## Deployment Shape

GitDB is packaged as a library and CLI. A production application should open a
store inside its own process, keep `GITDB_KEY` in that process environment when
encrypted mode is enabled, and choose whether remote GitHub sync is local-only,
background, or blocking for the workflow.

The Dockerfile builds the package and defaults to `gitdb check`, which verifies
that the configured store can be opened.

## Performance Direction

The current hot path is local. The next work is storage-engine work:

- Batch repository writes into one transaction
- Add page-level visible snapshots instead of whole-table rewrites
- Add primary and secondary indexes
- Compact mutation logs
- Batch Git object writes instead of writing one Contents API object per mutation
- Add explicit `fast` and `strong` durability modes

This keeps GitDB differentiated as a repository-backed runtime instead of a
network adapter over files.

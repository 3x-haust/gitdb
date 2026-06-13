# GitDB Benchmarks

Benchmarks are intentionally split between local engine speed and GitHub sync
speed. GitDB should feel fast because queries run against the local SQL engine;
GitHub is the durable sync layer, not the per-query hot path.

## Environment

- Date: 2026-06-14 KST
- Machine: macOS 26.5.1 arm64, Node.js 24.11.0
- Command: `GITDB_BENCH_ROWS=250 pnpm benchmark:compare`
- JSON evaluator: `GITDB_BENCH_OUTPUT=.gitdb/bench-current.json pnpm benchmark:evaluate`
- Baseline: `HEAD~1:docs/BENCHMARKS.md`
- Site evidence: `site/benchmark.json`
- Workload: create `teams` and `people`, insert rows, execute a join, reopen
  the store where applicable.

## Current Local Results

| Scenario | Rows | Write ms | Writes/s | Join ms | Reopen ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| local plaintext throttled visible snapshots | 250 | 97.55 | 2562.73 | 3.28 | 47.42 |
| local encrypted mutation log | 250 | 97.23 | 2571.34 | 0.87 | 45.26 |
| postgres facade over local encrypted | 250 | 148.46 | 1683.91 | 2.31 | 0.00 |

## Previous-Version Comparison

| Scenario | Previous writes/s | Current writes/s | Change | Write ms change | Join ms change |
| --- | ---: | ---: | ---: | ---: | ---: |
| local plaintext throttled visible snapshots | 173.14 | 2562.73 | +1380.15% | +93.24% | +90.04% |
| local encrypted mutation log | 328.09 | 2571.34 | +683.73% | +87.24% | +79.91% |
| postgres facade over local encrypted | 253.05 | 1683.91 | +565.45% | +84.97% | +88.30% |

## Historical GitHub Contents API

This was not rerun during the local performance pass. It remains the historical
remote-write reference from 2026-06-09 KST:

| Scenario | Rows | Write ms | Writes/s | Join ms | Reopen ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| github plaintext contents api | 2 | 14157.49 | 0.14 | 6.70 | 1812.62 |

## Interpretation

Local writes are now fast enough for examples, demos, and low-frequency project
data. The hot-path improvement is storage-engine shaped: a single-statement
mutation no longer clones and restores the whole in-memory database before every
write. It mutates the live local engine, persists through the manifest-gated log,
and restores committed state if persistence fails. Explicit multi-statement
transactions still use an isolated transaction database for rollback.

The first-party ORM API avoids the PostgreSQL wire hop for new apps, while the
facade remains useful for existing clients. Visible snapshots are checkpointed
instead of being rewritten on every local plaintext mutation.

GitHub Contents API writes are not acceptable as the hot write path. The current
GitHub plaintext mode writes multiple files per SQL mutation: log segment,
manifest, visible schema, and visible data. During benchmarking, GitHub also
returned transient 500/502 responses under repeated Contents API writes. GitDB
now retries those transient write failures, but the result confirms that direct
per-mutation GitHub writes are a demo path, not the final architecture.

## Performance Plan

1. Add a local write buffer.
   Return success after local WAL fsync in `fast` mode, then sync GitHub in the
   background.

2. Batch GitHub commits.
   Replace per-file Contents API writes with Git Database tree commits, so one
   transaction can update log, manifest, indexes, and visible snapshots in a
   single Git commit.

3. Snapshot less often.
   Keep mutation logs per write, but refresh visible `table/data.json` on a
   timer, row threshold, or explicit `gitdb sync` command.

4. Write table deltas.
   Store public rows as `table/rows/<primary-key>.json` or chunked pages, then
   rebuild `data.json` as a dashboard artifact. This avoids rewriting the whole
   table for every insert.

5. Add local indexes.
   Maintain primary and secondary indexes in local cache so joins and filters do
   not scan every visible row.

6. Add cold-start manifests.
   Include table snapshot versions in `manifest.json` so startup can skip
   directory listing and unchanged table reads.

7. Separate durability modes.
   Keep `fast` as local-durable/background-GitHub and add `strong` for blocking
   until the GitHub commit lands.

8. Add benchmark gates.
   Track local 1k/10k row writes, joins, reopen time, GitHub 10-row sync, and
   GitHub batch sync once tree commits land.

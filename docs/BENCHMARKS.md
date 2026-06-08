# GitDB Benchmarks

Benchmarks are intentionally split between local engine speed and GitHub sync
speed. GitDB should feel fast because queries run against the local SQL engine;
GitHub is the durable sync layer, not the per-query hot path.

## Environment

- Date: 2026-06-09 KST
- Machine: Apple Silicon laptop, Node.js 20.19.1
- Command: `pnpm benchmark`
- GitHub command: `GITDB_BENCH_GITHUB_ROWS=2 pnpm benchmark:github`
- Workload: create `teams` and `people`, insert rows, execute a join, reopen
  the store where applicable.

## Results

| Scenario | Rows | Write ms | Writes/s | Join ms | Reopen ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| local plaintext visible snapshots | 250 | 1443.90 | 173.14 | 32.97 | 140.05 |
| local encrypted mutation log | 250 | 761.99 | 328.09 | 4.31 | 322.51 |
| postgres facade over local encrypted | 250 | 987.93 | 253.05 | 19.74 | 0.00 |
| github plaintext contents api | 2 | 14157.49 | 0.14 | 6.70 | 1812.62 |

## Interpretation

Local writes are already usable for development workloads. The PostgreSQL wire
facade adds modest overhead while preserving normal ORM connectivity.

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

# GitDB Benchmarks

Benchmarks are split between raw local engine speed and first-party repository
speed. GitDB should feel fast because queries run against the local SQL engine;
GitHub is the durable sync layer, not the per-query hot path.

## Environment

- Date: 2026-06-14 KST
- Machine: macOS arm64
- Command: `GITDB_BENCH_ROWS=250 corepack pnpm benchmark:compare`
- Workload: create `teams` and `people`, insert rows, execute a join, reopen
  the store where applicable.

## Current Results

| Scenario | Rows | Write ms | Writes/s | Join ms | Reopen ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| local plaintext throttled visible snapshots | 250 | 146.75 | 1703.61 | 4.88 | 77.62 |
| local encrypted mutation log | 250 | 234.37 | 1066.70 | 1.18 | 78.31 |
| orm local plaintext | 250 | 5377.34 | 46.49 | 1.30 | 136.29 |

## Previous Local Run

The previous documented local engine results were:

| Scenario | Previous writes/s | Current writes/s | Change |
| --- | ---: | ---: | ---: |
| local plaintext visible snapshots | 173.14 | 1703.61 | +883.95% |
| local encrypted mutation log | 328.09 | 1066.70 | +225.12% |

The comparison is intentionally limited to the local engine scenarios that still
exist in the first-party runtime. Retired network-server numbers are no longer
part of the public benchmark surface.

## ORM Overhead

The raw engine inserts rows with direct SQL statements. `GitDbRepository.save()`
is safer but slower because it runs an upsert-style flow:

1. `DELETE FROM table WHERE pk = ?`
2. `INSERT INTO table (...) VALUES (...)`
3. Both statements inside a transaction

For bulk inserts today, prefer `dataSource.query()` with direct SQL. The roadmap
adds `repository.insert()` and `repository.saveMany()` so repository code can
batch rows without paying one transaction per row.

## Historical GitHub Contents API

GitHub Contents API writes are not acceptable as the hot write path. GitDB keeps
query execution local and treats GitHub as remote durable storage and reviewable
history. Direct per-mutation remote writes are useful for demos and correctness
testing, not for high-throughput writes.

## Performance Plan

1. Add batch repository writes.
   `saveMany()` should persist many entities through one transaction.

2. Add page-level visible snapshots.
   Plaintext mode should update changed pages instead of rewriting whole tables.

3. Add indexes.
   Maintain primary and secondary indexes in the local runtime so joins and
   filters avoid full scans.

4. Compact logs.
   Merge old mutation segments into periodic checkpoints.

5. Batch Git sync.
   Replace repeated Contents API writes with Git object tree commits.

6. Add durability modes.
   Keep `fast` as local-durable/background-GitHub and add `strong` for blocking
   until the remote commit lands.

7. Add benchmark gates.
   Track local 1k/10k row writes, repository bulk vs single-row writes, joins,
   reopen time, and remote batch sync once tree commits land.

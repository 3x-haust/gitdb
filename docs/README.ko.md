# GitDB

[English](../README.md) | 한국어 | [Website](https://3x-haust.github.io/gitdb/)

GitDB는 프로젝트 데이터를 위한 GitHub 기반 데이터베이스 런타임입니다. 쿼리와
쓰기의 hot path는 로컬 엔진에서 처리하고, GitHub 저장소는 durable storage와
audit trail로 사용합니다.

```text
Application code
  -> GitDB DataSource / Repository
  -> Local SQL engine + transaction queue
  -> Manifest, mutation log, visible snapshots
  -> GitHub repository for durable history
```

GitDB는 데이터베이스 파일 하나를 GitHub에 올리는 구조가 아닙니다. 핵심은
storage engine, transaction boundary, replay 가능한 mutation log, snapshot
모델, 그리고 그 위에 직접 붙는 first-party API입니다.

## 왜 GitDB인가

다음 상황에 적합합니다:

- 프로젝트마다 별도 database repository를 두고 싶을 때
- 매 쿼리마다 네트워크 왕복을 만들지 않고 로컬에서 실행하고 싶을 때
- 패키지에 포함된 TypeORM 스타일 `DataSource`와 repository API가 필요할 때
- 의도적인 public demo에서 table snapshot을 GitHub에서 바로 보고 싶을 때
- private data를 encrypted manifest와 mutation log로 저장하고 싶을 때
- agent memory, demo, content tool, config tool처럼 감사 가능한 기록이 필요한 저빈도 데이터

GitDB는 아직 실험 프로젝트입니다. 높은 처리량의 OLTP, 짧은 지연 시간의 다중
writer, 성숙한 secondary index가 필요한 워크로드에는 아직 적합하지 않습니다.

## 현재 표면

| 영역 | 현재 동작 |
| --- | --- |
| App API | `createGitDbDataSource`, `defineEntity`, typed repository |
| SQL engine | `CREATE TABLE`, `INSERT`, `DELETE`, `SELECT`, join, grouping, ordering, aggregate |
| Storage | local encrypted, local plaintext, GitHub encrypted, GitHub plaintext |
| Durability | manifest-gated mutation log replay와 visible snapshot checkpoint |
| CLI | `gitdb keygen`, `gitdb query`, `gitdb check` |
| Example | `examples/local-runtime`의 first-party local runtime 예제 |
| Package | npm exports, bin, pack dry-run, publish dry-run 설정 |

## 저장소 구조

Plaintext mode는 내부 상태와 사람이 읽을 수 있는 snapshot을 함께 씁니다:

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

Encrypted mode는 opaque 파일을 씁니다:

```text
gitdb/v1/
  manifest.enc
  log/
    00000000000000000001.enc
```

## 빠른 시작

```bash
corepack pnpm install
corepack pnpm build
```

First-party repository API:

```ts
import { LocalPlaintextStore, createGitDbDataSource, defineEntity } from "@3xhaust/gitdb"

type Person = {
  readonly id: string
  readonly name: string
  readonly team_id: string
}

const PersonEntity = defineEntity<Person>({
  columns: { id: "STRING", name: "STRING", team_id: "STRING" },
  primaryKey: "id",
  tableName: "people",
})

const dataSource = await createGitDbDataSource({
  entities: [PersonEntity],
  store: new LocalPlaintextStore({ root: ".gitdb" }),
  synchronize: true,
})

const people = dataSource.getRepository(PersonEntity)
await people.save({ id: "p1", name: "Lin", team_id: "storage" })
const storagePeople = await people.find({ where: { team_id: "storage" } })
```

예제 실행:

```bash
corepack pnpm example
```

예제는 local plaintext store를 열고, `teams`와 `people`을 쓰고, join을 실행한 뒤
store를 다시 열어 JSON summary를 출력합니다.

## CLI

Encryption key 생성:

```bash
node dist/src/cli/main.js keygen
```

Store 확인:

```bash
GITDB_ENCRYPTION=off GITDB_ROOT=.gitdb node dist/src/cli/main.js check
```

SQL 한 문장 실행:

```bash
GITDB_ENCRYPTION=off GITDB_ROOT=.gitdb \
  node dist/src/cli/main.js query "CREATE TABLE people (id STRING, name STRING)"
```

## 환경 변수

Local plaintext mode:

```env
GITDB_ENCRYPTION=off
GITDB_ROOT=.gitdb
```

Local encrypted mode:

```env
GITDB_ENCRYPTION=on
GITDB_KEY=generated-by-gitdb-keygen
GITDB_ROOT=.gitdb
```

GitHub 저장소를 쓸 때는 아래 값을 추가합니다:

```env
GITDB_GITHUB_OWNER=3x-haust
GITDB_GITHUB_REPO=my-project-db
GITDB_GITHUB_BRANCH=main
GITDB_GITHUB_PREFIX=gitdb/v1
GITDB_GITHUB_TOKEN=github_token_with_contents_write_access
```

로컬 개발만 할 때는 `GITDB_GITHUB_TOKEN`을 비워둡니다. `GITDB_ENCRYPTION=off`는
table 이름, column, row가 공개되어도 되는 demo에서만 사용하세요.

## 아키텍처

GitDB는 네 계층으로 나뉩니다:

1. First-party API
   - `DataSource`, `Repository`, `save`, `find`, `findOne`, `delete`, raw
     `query`, transaction access를 제공합니다.
   - 새 앱이 GitDB runtime 표면에 직접 붙도록 합니다.

2. SQL engine
   - Schema, mutation, query, join, grouping, ordering, result row를 처리합니다.
   - Local mutation을 persistence 전에 직렬화합니다.

3. Storage provider
   - Local encrypted store
   - Local plaintext store
   - GitHub encrypted/plaintext store

4. Audit and recovery model
   - Manifest가 committed sequence를 기록합니다.
   - Mutation log는 open 시 replay 가능합니다.
   - Visible snapshot은 plaintext reopen path를 빠르게 합니다.

자세한 내용은 [ARCHITECTURE.md](ARCHITECTURE.md)를 참고하세요.

## 벤치마크

Local benchmark:

```bash
corepack pnpm benchmark
```

Website benchmark evidence 갱신:

```bash
GITDB_BENCH_ROWS=250 corepack pnpm benchmark:site
```

이전 local run과 비교:

```bash
GITDB_BENCH_ROWS=250 corepack pnpm benchmark:compare
```

최근 측정:

| Scenario | Rows | Write ms | Writes/s | Join ms | Reopen ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| local plaintext throttled visible snapshots | 250 | 146.75 | 1703.61 | 4.88 | 77.62 |
| local encrypted mutation log | 250 | 234.37 | 1066.70 | 1.18 | 78.31 |
| orm local plaintext | 250 | 5377.34 | 46.49 | 1.30 | 136.29 |

해석: raw local execution은 demo와 저빈도 프로젝트 데이터에 충분히 빠릅니다.
Repository `save()`는 row마다 작은 transaction을 쓰기 때문에 안전하지만 아직
느립니다. 다음 성능 작업은 batch repository write, page-level snapshot, index,
log compaction, batched Git sync입니다.

자세한 내용은 [BENCHMARKS.md](BENCHMARKS.md)를 참고하세요.

## 현재 한계

- SQL 지원 범위는 현재 실행 가능한 subset으로 제한됩니다.
- Repository `save()`는 bulk insert에 최적화되어 있지 않습니다.
- Multi-process writer는 remote state로 보호하지만 아직 높은 동시성의 OLTP DB는 아닙니다.
- GitHub Contents API mode는 demo와 correctness test용이지 production write throughput용이 아닙니다.
- Public plaintext mode는 private mode가 아닙니다.

지원하지 않는 SQL은 조용히 성공한 척하지 않고 명시적으로 실패해야 합니다.

## Commands

```bash
corepack pnpm check
corepack pnpm test
corepack pnpm build
corepack pnpm benchmark
corepack pnpm benchmark:evaluate
corepack pnpm pack:dry-run
corepack pnpm publish:dry-run
corepack pnpm example
```

## License

MIT

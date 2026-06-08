# GitDB

[English](../README.md) | 한국어

GitDB는 GitHub repository 하나를 프로젝트 전용 데이터베이스처럼 쓰게 해주는
GitHub-native database입니다.

애플리케이션은 GitDB가 여는 PostgreSQL 호환 로컬 TCP endpoint에 접속합니다.
Prisma나 `pg` 같은 기존 PostgreSQL 클라이언트는 평범한
`postgresql://127.0.0.1:7432/main` 주소로 SQL을 보내고, GitDB는 그 SQL을 자체
엔진에서 실행한 뒤 전용 GitHub repository에 데이터베이스 상태를 저장합니다.

```text
Express / Prisma / pg
        |
        | postgresql://127.0.0.1:7432/main
        v
GitDB PostgreSQL facade
        |
        | SQL engine + local WAL/cache
        v
GitHub repository
```

GitDB는 SQLite를 GitHub에 올리는 도구가 아닙니다. `.db` 파일을 업로드하지
않습니다. GitHub repository 자체가 GitDB의 durable database store입니다.

## 왜 GitDB인가

GitHub에는 이미 commit, pull request, history, branch, review, public/private
repo, access control이 있습니다. GitDB는 이 GitHub primitive를 프로젝트 데이터에
적용합니다.

GitDB가 잘 맞는 경우:

- 프로젝트마다 전용 데이터베이스 repo를 두고 싶을 때, 예: `my-app-db`
- Prisma, TypeORM, Drizzle, Kysely provider를 직접 만들고 싶지 않을 때
- public demo 데이터를 GitHub 웹 UI에서 바로 보고 수정하고 싶을 때
- public/private repo에 데이터를 암호화해서 저장하고 싶을 때
- agent memory, demo, content tool, config tool, 저빈도 앱 데이터를 commit
  history로 남기고 싶을 때

GitDB가 맞지 않는 경우:

- 고빈도 OLTP
- 낮은 지연시간의 다중 writer transaction
- 오늘 당장 완전한 PostgreSQL 호환성이 필요한 서비스

## 기능

| 영역 | 현재 동작 |
| --- | --- |
| ORM 접근 | PostgreSQL 스타일 로컬 endpoint를 열어 기존 PostgreSQL client가 접속 |
| SQL | `CREATE TABLE`, `INSERT`, `DELETE`, `SELECT`, join, group, order, aggregate, 일반적인 raw query 흐름 |
| GitHub 저장소 | 데이터베이스마다 전용 repo 사용, 권한이 있으면 최초 write 시 repo 생성 |
| Public plaintext mode | `table/schema.json`, `table/data.json`을 GitHub에서 직접 확인/수정 |
| Encrypted mode | AES-256-GCM으로 암호화된 manifest/log 저장 |
| Local mode | GitHub 변수 없이 로컬 디렉터리에 저장 |
| Example app | Express + Prisma API가 PostgreSQL facade를 통해 GitDB 사용 |
| Benchmark | local, facade, GitHub Contents API 벤치마크 명령 포함 |

## GitHub에 저장되는 구조

plaintext public mode에서는 내부 mutation log와 사람이 보기 쉬운 table snapshot을
같이 저장합니다.

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

`schema.json`에는 schema만 들어갑니다.

```json
{
  "name": "people",
  "columns": ["id", "name", "team_id"]
}
```

`data.json`에는 row만 들어갑니다.

```json
[
  { "id": "p1", "name": "Lin", "team_id": "t1" },
  { "id": "p2", "name": "Ada", "team_id": "t2" }
]
```

그래서 public database repo는 가벼운 Firebase 콘솔처럼 확인할 수 있습니다.
GitHub 웹에서 `data.json`을 수정하고 commit하면, 다음 GitDB open 시 visible table
snapshot에서 데이터를 복원합니다.

encrypted mode에서는 opaque file만 저장합니다.

```text
gitdb/v1/
  manifest.enc
  log/
    00000000000000000001.enc
```

## 빠른 시작

설치와 빌드:

```bash
pnpm install
pnpm build
```

encrypted local storage로 PostgreSQL facade 실행:

```bash
export GITDB_KEY="$(node dist/src/cli/main.js keygen)"
pnpm start:facade
```

`psql`, `pg`, Prisma 등 PostgreSQL client로 접속:

```bash
psql postgresql://127.0.0.1:7432/main
```

예시 SQL:

```sql
CREATE TABLE teams (id STRING, name STRING);
CREATE TABLE people (id STRING, name STRING, team_id STRING);

INSERT INTO teams VALUES ('t1', 'Storage');
INSERT INTO people VALUES ('p1', 'Lin', 't1');

SELECT people.name, teams.name AS team
FROM people
JOIN teams ON people.team_id = teams.id;
```

## Express + Prisma 예제

예제는 실제 API 서비스 형태입니다. Express가 HTTP route를 제공하고, Prisma는
PostgreSQL facade를 통해 GitDB에 접속하며, GitDB는 example `.env`에 설정된 로컬
디렉터리 또는 GitHub database repo에 저장합니다.

```bash
cp examples/express-prisma/.env.example examples/express-prisma/.env
pnpm example
```

다른 터미널에서:

```bash
curl http://127.0.0.1:3090/health
curl -X POST http://127.0.0.1:3090/seed
curl http://127.0.0.1:3090/people
```

example은 기본적으로 plaintext mode입니다.

```env
GITDB_ENCRYPTION=off
GITDB_ROOT=.gitdb-example-public
GITDB_GITHUB_OWNER=3x-haust
GITDB_GITHUB_REPO=gitdb-example-db
GITDB_GITHUB_BRANCH=main
GITDB_GITHUB_PREFIX=gitdb/v1
GITDB_GITHUB_TOKEN=
API_PORT=3090
```

`GITDB_GITHUB_TOKEN`을 비워두면 로컬 파일로 테스트합니다. GitHub에 실제로 쓰고
싶으면 dedicated database repo에 Contents read/write 권한이 있는 token을 넣으면
됩니다. repo가 아직 없으면 owner 아래 repo를 생성할 권한도 필요합니다.

## 환경 변수 모델

루트 `.env`는 GitDB facade process용입니다.

```env
GITDB_ENCRYPTION=on
GITDB_KEY=generated-by-gitdb-keygen
GITDB_ROOT=.gitdb
GITDB_HOST=0.0.0.0
GITDB_PORT=7432
```

example은 각자 별도의 `.env`를 둡니다. app 설정과 database-repository 설정이
package root에 섞이지 않게 하기 위해서입니다.

### 암호화

`GITDB_KEY`는 GitDB가 생성한 base64url 32-byte key여야 합니다.

```bash
node dist/src/cli/main.js keygen
```

이 값은 Git에 올리면 안 됩니다. key가 바뀌면 기존 encrypted data를 복호화할 수
없습니다.

`GITDB_ENCRYPTION=off`는 table name, column, row를 GitHub에서 공개적으로 보고
싶은 demo에서만 사용하세요.

### GitHub storage

facade를 실행하는 process에 아래 변수를 넣습니다.

```bash
export GITDB_GITHUB_OWNER="3x-haust"
export GITDB_GITHUB_REPO="my-project-db"
export GITDB_GITHUB_BRANCH="main"
export GITDB_GITHUB_PREFIX="gitdb/v1"
export GITDB_GITHUB_TOKEN="github_pat_... or ghp_..."
gitdb serve
```

권장 구조:

- source repo: `my-project`
- database repo: `my-project-db`
- 공개 demo data: `GITDB_ENCRYPTION=off`
- 실제 public/private data: `GITDB_ENCRYPTION=on`

## Runtime과 신뢰 모델

`gitdb serve`와 hosted GitDB endpoint는 같은 종류의 runtime입니다. 둘 다
PostgreSQL facade, SQL engine, GitHub sync를 담당합니다. 중요한 차이는 그 runtime이
어디에서 실행되느냐입니다.

| Mode | Runtime 위치 | 누가 복호화 가능한가 | 적합한 경우 |
| --- | --- | --- | --- |
| Self-hosted encrypted | 유저 앱 서버, VPS, 로컬, private infra | `GITDB_KEY`를 가진 유저 환경만 | 실제 앱 데이터, public encrypted repo, private repo |
| Hosted plaintext | `gitdb.3xhaust.dev` 같은 GitDB hosted runtime | 어차피 GitHub repo를 보는 모두 | public demo, public dataset, inspectable example |
| Hosted encrypted | GitDB hosted runtime | hosted runtime이 key를 받아야 함 | 편의성을 위한 managed mode, zero-knowledge 아님 |

암호화된 데이터를 “내 서비스만 복호화 가능”하게 만들고 싶다면 GitDB를 직접
호스트해야 합니다.

```text
Your App -> your gitdb serve -> encrypted GitHub repo
```

`GITDB_KEY`를 hosted runtime에 보내는 순간, 그 runtime은 query 실행을 위해
plaintext를 처리할 수 있습니다. 이건 의도적으로 key를 맡기는 managed mode이지,
운영자도 볼 수 없는 구조가 아닙니다.

## 아키텍처

GitDB는 세 층으로 나뉩니다.

1. PostgreSQL-compatible facade
   - 로컬 TCP endpoint를 엽니다.
   - 기존 client가 평범한 PostgreSQL connection string으로 접속합니다.
   - ORM별 provider/driver를 만들지 않아도 됩니다.

2. SQL engine
   - schema, mutation execution, query execution, join, grouping, result row를
     처리합니다.
   - Node.js client와 ORM raw-query 흐름에서 자주 나오는 PostgreSQL subset을
     우선 지원합니다.

3. Storage provider
   - 개발/테스트용 local encrypted store
   - visible snapshot용 local plaintext store
   - remote durability용 GitHub encrypted/plaintext store

자세한 내용은 [ARCHITECTURE.md](ARCHITECTURE.md)를 참고하세요.

## 벤치마크

로컬 벤치마크:

```bash
pnpm benchmark
```

GitHub write 벤치마크:

```bash
GITDB_BENCH_GITHUB_ROWS=2 pnpm benchmark:github
```

최근 측정 결과:

| Scenario | Rows | Write ms | Writes/s | Join ms | Reopen ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| local plaintext visible snapshots | 250 | 1443.90 | 173.14 | 32.97 | 140.05 |
| local encrypted mutation log | 250 | 761.99 | 328.09 | 4.31 | 322.51 |
| postgres facade over local encrypted | 250 | 987.93 | 253.05 | 19.74 | 0.00 |
| github plaintext contents api | 2 | 14157.49 | 0.14 | 6.70 | 1812.62 |

해석은 분명합니다. local execution은 개발/저빈도 workload에는 쓸 만합니다. 하지만
mutation마다 GitHub Contents API를 직접 호출하는 방식은 hot path가 될 수
없습니다. 실제 성능은 local WAL, cache, index, batched Git commit 구조에서 나와야
합니다.

자세한 내용은 [BENCHMARKS.md](BENCHMARKS.md)를 참고하세요.

## 성능 개선 로드맵

다음 성능 개선은 facade보다 storage 구조가 핵심입니다.

- Local WAL first: `fast` mode에서는 local durable write 후 성공 반환
- Batched Git commits: 반복 Contents API write를 Git Database tree commit으로 교체
- Snapshot throttling: 매 mutation마다 `data.json`을 다시 쓰지 않기
- Chunked table pages: row 하나 때문에 table 전체를 다시 쓰지 않기
- Local primary/secondary index: join/filter가 GitHub hot path를 타지 않게 하기
- Manifest versions: cold start에서 unchanged table read 생략
- Strong mode: 필요할 때만 GitHub commit 완료까지 block

## 보안 모델

encrypted mode에서는 manifest와 mutation log를 AES-256-GCM으로 암호화합니다.
복호화 key는 repository에 저장하지 않습니다.

public GitHub repository에서는 암호화해도 아래 metadata는 드러날 수 있습니다.

- commit 시간
- file 개수
- 대략적인 file 크기
- write 빈도

완화 방법은 batch, padding, compaction, 향후 opaque path storage입니다.

## 현재 한계

- SQL 지원 범위는 현재 GitDB engine이 실행하는 subset입니다.
- PostgreSQL catalog emulation은 아직 완전하지 않습니다.
- multi-process writer는 GitHub state로 감지하지만, 고동시성 OLTP database는
  아닙니다.
- GitHub Contents API mode는 demo/correctness test용이지 production write
  throughput용이 아닙니다.
- public plaintext mode는 말 그대로 공개 모드입니다.

지원하지 않는 SQL은 조용히 틀린 결과를 내지 않고 명시적으로 실패해야 합니다.

## 참고한 오픈소스 프로젝트

GitDB의 README와 제품 설명 구조는 아래 프로젝트들의 README를 참고했습니다.

- [Dolt](https://github.com/dolthub/dolt): "Git for Data"라는 명확한 positioning과
  SQL + Git-style collaboration.
- [Supabase](https://github.com/supabase/supabase): Postgres 중심의 open-source
  Firebase-like developer experience.
- [Nhost](https://github.com/nhost/nhost): 짧은 첫 화면 positioning, quickstart,
  SQL-backed Firebase alternative framing.
- [PocketBase](https://github.com/pocketbase/pocketbase): 작고 inspectable한 backend
  surface와 직접적인 feature list.
- [Appwrite](https://github.com/appwrite/appwrite): installation, self-hosting,
  community path가 분명한 product-oriented README.
- [Prisma](https://github.com/prisma/prisma), [Drizzle](https://github.com/drizzle-team/drizzle-orm),
  [Kysely](https://github.com/kysely-org/kysely): GitDB가 ORM별 provider 대신
  PostgreSQL facade를 선택한 이유.

## 명령어

```bash
pnpm check
pnpm test
pnpm build
pnpm benchmark
pnpm start:facade
pnpm example
```

## 배포

배포 서비스는 NestJS HTTP control plane과 PostgreSQL-compatible facade를 같은
process에서 실행합니다.

```bash
docker build -t gitdb .
docker run -p 3000:3000 -p 7432:7432 --env-file .env gitdb
```

`pnpm start`는 HTTP control plane을 실행합니다. `pnpm start:facade`는 local ORM
test용 TCP facade만 실행합니다.

현재 public HTTP control plane:

```text
https://gitdb.3xhaust.dev/health
```

`gitdb.3xhaust.dev`는 hosted GitDB runtime/control-plane instance로 보면 됩니다.
public plaintext workflow, demo, setup flow, 향후 managed mode에는 유용합니다.
하지만 encrypted data를 내 서비스만 복호화하게 만들고 싶다면 직접 `gitdb serve`를
실행하고 `GITDB_KEY`를 그 환경에만 둬야 합니다.

HTTP deployment가 외부 ORM client에 TCP facade를 자동으로 노출하는 것은 아닙니다.
remote ORM access가 필요하면 application 근처에서 `gitdb serve`를 실행하거나 TCP
port `7432`를 노출하는 배포 환경을 사용해야 합니다.

## 라이선스

MIT

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createGitDbDataSource, defineEntity, LocalPlaintextStore } from "../../dist/src/index.js"

const Team = defineEntity({
  columns: {
    id: "STRING",
    name: "STRING",
  },
  primaryKey: "id",
  tableName: "teams",
})

const Person = defineEntity({
  columns: {
    id: "STRING",
    name: "STRING",
    team_id: "STRING",
  },
  primaryKey: "id",
  tableName: "people",
})

const root = await mkdtemp(join(tmpdir(), "gitdb-local-runtime-"))

try {
  const entities = [Team, Person]
  const dataSource = await createGitDbDataSource({
    entities,
    store: new LocalPlaintextStore({ root }),
    synchronize: true,
  })

  await dataSource.getRepository(Team).save({ id: "t1", name: "Storage" })
  await dataSource.getRepository(Person).save({ id: "p1", name: "Lin", team_id: "t1" })

  const joined = await dataSource.query(
    "SELECT people.name AS person, teams.name AS team FROM people JOIN teams ON people.team_id = teams.id",
  )
  const reopened = await createGitDbDataSource({
    entities,
    store: new LocalPlaintextStore({ root }),
    synchronize: false,
  })

  const summary = {
    joined,
    mode: "local-plaintext",
    reopenedPeople: await reopened.getRepository(Person).find(),
    status: "ok",
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
} finally {
  await rm(root, { force: true, recursive: true })
}

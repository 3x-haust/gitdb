import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createGitDbDataSource, defineEntity, type EntityDefinition } from "../src/orm/index.js"
import { LocalPlaintextStore } from "../src/storage/local-plaintext-store.js"

type Person = {
  readonly id: string
  readonly name: string
  readonly team_id: string
}

const PersonEntity = defineEntity<Person>({
  columns: {
    id: "STRING",
    name: "STRING",
    team_id: "STRING",
  },
  primaryKey: "id",
  tableName: "people",
})

describe("GitDB ORM", () => {
  it("rejects unsupported JSON column metadata", () => {
    // Given: entity metadata that claims a JSON column.
    const entity = {
      columns: {
        id: "STRING",
        metadata: "JSON",
      },
      primaryKey: "id",
      tableName: "people",
    } as unknown as EntityDefinition<{ readonly id: string; readonly metadata: string }>

    // When/Then: the ORM refuses a type it cannot persist faithfully yet.
    expect(() => defineEntity(entity)).toThrow()
  })

  it("saves, finds, and deletes entities through a TypeORM-style repository", async () => {
    // Given: a GitDB data source synchronized from entity metadata.
    const root = await mkdtemp(join(tmpdir(), "gitdb-orm-"))
    const dataSource = await createGitDbDataSource({
      entities: [PersonEntity],
      store: new LocalPlaintextStore({ root }),
      synchronize: true,
    })
    const people = dataSource.getRepository(PersonEntity)

    // When: callers use repository methods instead of raw SQL.
    await people.save({ id: "p1", name: "Lin", team_id: "storage" })
    await people.save({ id: "p2", name: "Ada", team_id: "runtime" })
    const found = await people.find({ where: { team_id: "storage" } })
    const one = await people.findOne({ where: { id: "p2" } })
    await people.delete({ id: "p1" })

    // Then: the repository exposes typed CRUD ergonomics over the local runtime.
    await expect(people.find()).resolves.toEqual([{ id: "p2", name: "Ada", team_id: "runtime" }])
    expect(found).toEqual([{ id: "p1", name: "Lin", team_id: "storage" }])
    expect(one).toEqual({ id: "p2", name: "Ada", team_id: "runtime" })
  })
})

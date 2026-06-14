import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createAesGcmCipher } from "../src/crypto/aes-gcm.js"
import { createGitDbDataSource, defineEntity } from "../src/orm/index.js"
import { LocalEncryptedStore } from "../src/storage/local-encrypted-store.js"

type Team = {
  readonly id: string
  readonly name: string
}

type Person = {
  readonly id: string
  readonly name: string
  readonly team_id: string
}

const TeamEntity = defineEntity<Team>({
  columns: {
    id: "STRING",
    name: "STRING",
  },
  primaryKey: "id",
  tableName: "teams",
})

const PersonEntity = defineEntity<Person>({
  columns: {
    id: "STRING",
    name: "STRING",
    team_id: "STRING",
  },
  primaryKey: "id",
  tableName: "people",
})

describe("GitDB first-party runtime", () => {
  it("writes through repositories, joins through the engine, and reopens encrypted state", async () => {
    // Given: a GitDB data source backed by encrypted local storage.
    const root = await mkdtemp(join(tmpdir(), "gitdb-runtime-"))
    const key = Buffer.alloc(32, 3).toString("base64url")
    const cipher = createAesGcmCipher(key)
    const entities = [TeamEntity, PersonEntity]
    const dataSource = await createGitDbDataSource({
      entities,
      store: new LocalEncryptedStore({ cipher, root }),
      synchronize: true,
    })

    // When: an app uses first-party repositories and SQL on the same runtime.
    await dataSource.getRepository(TeamEntity).save({ id: "t1", name: "Storage" })
    await dataSource.getRepository(PersonEntity).save({ id: "p1", name: "Lin", team_id: "t1" })
    const joined = await dataSource.query(
      "SELECT people.name AS person, teams.name AS team FROM people JOIN teams ON people.team_id = teams.id",
    )
    const reopened = await createGitDbDataSource({
      entities,
      store: new LocalEncryptedStore({ cipher: createAesGcmCipher(key), root }),
      synchronize: false,
    })

    // Then: the runtime behaves as one database across repository, query, and reopen paths.
    expect(joined).toEqual([{ person: "Lin", team: "Storage" }])
    await expect(reopened.getRepository(PersonEntity).find()).resolves.toEqual([
      { id: "p1", name: "Lin", team_id: "t1" },
    ])
  })
})

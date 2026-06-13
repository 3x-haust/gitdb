import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { GitDbStorageError } from "../errors.js"
import type {
  GitDbManifest,
  PersistedMutation,
  SegmentId,
  VisibleDatabaseSnapshot,
} from "../types.js"
import {
  parsePlaintextManifest,
  parsePlaintextMutation,
  parseVisibleTableRows,
  parseVisibleTableSchema,
  segmentIdForSequence,
  stringifyPlaintext,
} from "./plaintext-codec.js"
import type { GitDbStore } from "./store.js"

type LocalPlaintextStoreOptions = {
  readonly root: string
}

export class LocalPlaintextStore implements GitDbStore {
  readonly #root: string

  constructor(options: LocalPlaintextStoreOptions) {
    this.#root = join(options.root, "gitdb", "v1")
  }

  async readManifest(): Promise<GitDbManifest | null> {
    const payload = await this.#readNullable(join(this.#root, "manifest.json"))
    return payload === null ? null : parsePlaintextManifest(payload)
  }

  async writeManifest(manifest: GitDbManifest): Promise<void> {
    await this.#writeJson(join(this.#root, "manifest.json"), manifest)
  }

  async appendMutation(mutation: PersistedMutation): Promise<SegmentId> {
    const id = segmentIdForSequence(mutation.sequence)
    await this.#writeJson(join(this.#root, "log", `${id}.json`), mutation)
    return id
  }

  async readMutations(segments: readonly SegmentId[]): Promise<readonly PersistedMutation[]> {
    const mutations: PersistedMutation[] = []
    for (const segment of segments) {
      const payload = await this.#readNullable(join(this.#root, "log", `${segment}.json`))
      if (payload === null) {
        throw new GitDbStorageError(`missing mutation segment ${segment}`)
      }
      mutations.push(parsePlaintextMutation(payload))
    }
    return mutations
  }

  async readVisibleSnapshot(): Promise<VisibleDatabaseSnapshot | null> {
    const checkpoint = await this.#readSnapshotCheckpoint()
    const tableNames = await this.#readDirectoryNames()
    const tables = []
    for (const tableName of tableNames) {
      const schemaPayload = await this.#readNullable(join(this.#root, tableName, "schema.json"))
      const dataPayload = await this.#readNullable(join(this.#root, tableName, "data.json"))
      if (schemaPayload !== null && dataPayload !== null) {
        const schema = parseVisibleTableSchema(schemaPayload)
        tables.push({
          ...schema,
          rows: parseVisibleTableRows(dataPayload),
        })
      }
    }
    if (tables.length === 0) {
      return null
    }
    return checkpoint === undefined ? { tables } : { sequence: checkpoint, tables }
  }

  async writeVisibleSnapshot(snapshot: VisibleDatabaseSnapshot): Promise<void> {
    for (const table of snapshot.tables) {
      await this.#writeJson(join(this.#root, table.name, "schema.json"), {
        columns: table.columns,
        name: table.name,
      })
      await this.#writeJson(join(this.#root, table.name, "data.json"), table.rows)
    }
    if (snapshot.sequence !== undefined) {
      await this.#writeJson(join(this.#root, "snapshot.json"), { sequence: snapshot.sequence })
    }
  }

  async #writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, stringifyPlaintext(value), "utf8")
  }

  async #readDirectoryNames(): Promise<readonly string[]> {
    try {
      const entries = await readdir(this.#root, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => name !== "log")
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return []
      }
      throw error
    }
  }

  async #readSnapshotCheckpoint(): Promise<number | undefined> {
    const payload = await this.#readNullable(join(this.#root, "snapshot.json"))
    if (payload === null) {
      return undefined
    }
    const parsed = JSON.parse(payload) as { readonly sequence?: unknown }
    return typeof parsed.sequence === "number" ? parsed.sequence : undefined
  }

  async #readNullable(path: string): Promise<string | null> {
    try {
      return await readFile(path, "utf8")
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null
      }
      throw error
    }
  }
}

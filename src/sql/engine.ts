import alasql from "alasql"
import { z } from "zod"
import { SqlExecutionError } from "../errors.js"
import type { GitDbStore } from "../storage/store.js"
import type {
  GitDbManifest,
  PersistedMutation,
  SqlResult,
  VisibleDatabaseSnapshot,
} from "../types.js"
import { maybeCatalogResult } from "./catalog.js"
import { commandTag, isMutation, isTransactionControl, normalizePostgresSql } from "./normalize.js"
import { toRows } from "./rows.js"

type GitDbEngineOptions = {
  readonly store: GitDbStore
}

const AlaSqlColumnSchema = z.object({
  columnid: z.string().min(1),
})

const AlaSqlTableSchema = z.object({
  columns: z.array(AlaSqlColumnSchema),
  data: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
})

const AlaSqlTablesSchema = z.record(z.string(), AlaSqlTableSchema)

export class GitDbEngine {
  readonly #db: InstanceType<typeof alasql.Database>
  readonly #store: GitDbStore
  #manifest: GitDbManifest

  private constructor(store: GitDbStore, manifest: GitDbManifest) {
    this.#store = store
    this.#manifest = manifest
    this.#db = new alasql.Database("gitdb")
    alasql.options.postgres = true
  }

  static async open(options: GitDbEngineOptions): Promise<GitDbEngine> {
    const now = new Date().toISOString()
    const manifest =
      (await options.store.readManifest()) ??
      ({
        version: 1,
        sequence: 0,
        createdAt: now,
        updatedAt: now,
        logSegments: [],
      } satisfies GitDbManifest)
    const engine = new GitDbEngine(options.store, manifest)
    const restoredSnapshot = await engine.#restoreVisibleSnapshot()
    if (!restoredSnapshot) {
      await engine.#replay()
    }
    if (manifest.sequence === 0) {
      await options.store.writeManifest(manifest)
    }
    return engine
  }

  async execute(sql: string): Promise<SqlResult> {
    const catalog = maybeCatalogResult(sql)
    if (catalog !== null) {
      return catalog
    }
    if (isTransactionControl(sql)) {
      return { command: commandTag(sql, 0), rowCount: 0, rows: [] }
    }
    const normalized = normalizePostgresSql(sql)
    const result = this.#exec(normalized, sql)
    const rows = toRows(result)
    const rowCount = rows.length > 0 ? rows.length : typeof result === "number" ? result : 0
    const response = { command: commandTag(sql, rowCount), rowCount, rows } satisfies SqlResult
    if (isMutation(sql)) {
      await this.#persist(sql)
      await this.#persistVisibleSnapshot()
    }
    return response
  }

  async #restoreVisibleSnapshot(): Promise<boolean> {
    if (this.#store.readVisibleSnapshot === undefined) {
      return false
    }
    const snapshot = await this.#store.readVisibleSnapshot()
    if (snapshot === null) {
      return false
    }
    for (const table of snapshot.tables) {
      const columns = table.columns.map((column) => `${column} STRING`).join(", ")
      this.#exec(`CREATE TABLE IF NOT EXISTS ${table.name} (${columns})`, `restore ${table.name}`)
      for (const row of table.rows) {
        const values = table.columns.map((column) => sqlLiteral(row[column] ?? null)).join(", ")
        this.#exec(`INSERT INTO ${table.name} VALUES (${values})`, `restore ${table.name}`)
      }
    }
    return true
  }

  async #persistVisibleSnapshot(): Promise<void> {
    if (this.#store.writeVisibleSnapshot === undefined) {
      return
    }
    await this.#store.writeVisibleSnapshot(this.#visibleSnapshot())
  }

  #visibleSnapshot(): VisibleDatabaseSnapshot {
    const parsed = AlaSqlTablesSchema.parse(this.#db.tables)
    return {
      tables: Object.entries(parsed).map(([name, table]) => ({
        columns: table.columns.map((column) => column.columnid),
        name,
        rows: table.data,
      })),
    }
  }

  async #replay(): Promise<void> {
    const mutations = await this.#store.readMutations(this.#manifest.logSegments)
    for (const mutation of mutations) {
      this.#exec(normalizePostgresSql(mutation.sql), mutation.sql)
    }
  }

  async #persist(sql: string): Promise<void> {
    const nextSequence = this.#manifest.sequence + 1
    const at = new Date().toISOString()
    const mutation = { at, sequence: nextSequence, sql } satisfies PersistedMutation
    const segment = await this.#store.appendMutation(mutation)
    this.#manifest = {
      ...this.#manifest,
      sequence: nextSequence,
      updatedAt: at,
      logSegments: [...this.#manifest.logSegments, segment],
    }
    await this.#store.writeManifest(this.#manifest)
  }

  #exec(normalizedSql: string, originalSql: string): unknown {
    try {
      return this.#db.exec(normalizedSql)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new SqlExecutionError(originalSql, detail)
    }
  }
}

function sqlLiteral(value: string | number | boolean | null): string {
  if (value === null) {
    return "NULL"
  }
  if (typeof value === "number") {
    return value.toString()
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE"
  }
  return `'${value.replaceAll("'", "''")}'`
}

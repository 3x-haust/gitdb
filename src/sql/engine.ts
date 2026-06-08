import alasql from "alasql"
import { SqlExecutionError } from "../errors.js"
import type { GitDbStore } from "../storage/store.js"
import type { GitDbManifest, PersistedMutation, SqlResult } from "../types.js"
import { maybeCatalogResult } from "./catalog.js"
import { commandTag, isMutation, isTransactionControl, normalizePostgresSql } from "./normalize.js"
import { toRows } from "./rows.js"

type GitDbEngineOptions = {
  readonly store: GitDbStore
}

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
    await engine.#replay()
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
    }
    return response
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

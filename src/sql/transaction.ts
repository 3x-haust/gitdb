import type { SqlResult } from "../types.js"
import { maybeCatalogResult } from "./catalog.js"
import type { AlaSqlDatabase } from "./database.js"
import { execOn } from "./database.js"
import { commandTag, isMutation, isTransactionControl, normalizePostgresSql } from "./normalize.js"
import { toRows } from "./rows.js"

export interface GitDbTransaction {
  execute(sql: string): Promise<SqlResult>
}

export class EngineTransaction implements GitDbTransaction {
  readonly #db: AlaSqlDatabase
  readonly #mutations: string[] = []

  constructor(db: AlaSqlDatabase) {
    this.#db = db
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
    const result = execOn(this.#db, normalized, sql)
    const rows = toRows(result)
    const rowCount = rows.length > 0 ? rows.length : typeof result === "number" ? result : 0
    if (isMutation(sql)) {
      this.#mutations.push(sql)
    }
    return { command: commandTag(sql, rowCount), rowCount, rows }
  }

  mutations(): readonly string[] {
    return this.#mutations
  }
}

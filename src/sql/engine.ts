import alasql from "alasql"
import { SqlExecutionError } from "../errors.js"
import type { GitDbStore } from "../storage/store.js"
import type { GitDbManifest, PersistedMutation, SqlResult } from "../types.js"
import { maybeCatalogResult } from "./catalog.js"
import {
  type AlaSqlDatabase,
  createDatabase,
  databaseFromSnapshot,
  execOn,
  restoreSnapshot,
  snapshotFromDatabase,
} from "./database.js"
import { commandTag, isMutation, isTransactionControl, normalizePostgresSql } from "./normalize.js"
import { toRows } from "./rows.js"
import { EngineTransaction, type GitDbTransaction } from "./transaction.js"

export type { GitDbTransaction } from "./transaction.js"

type GitDbEngineOptions = {
  readonly store: GitDbStore
  readonly snapshotPolicy?: SnapshotPolicy
}

export type SnapshotPolicy =
  | { readonly mode: "everyMutation" }
  | { readonly mode: "interval"; readonly mutations: number }

export class GitDbEngine {
  #db: AlaSqlDatabase
  readonly #store: GitDbStore
  readonly #snapshotPolicy: SnapshotPolicy
  #manifest: GitDbManifest
  #mutationQueue = Promise.resolve()
  #lastVisibleSnapshotError: unknown = undefined

  private constructor(store: GitDbStore, manifest: GitDbManifest, snapshotPolicy: SnapshotPolicy) {
    this.#store = store
    this.#manifest = manifest
    this.#snapshotPolicy = snapshotPolicy
    this.#db = createDatabase()
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
    const engine = new GitDbEngine(
      options.store,
      manifest,
      options.snapshotPolicy ?? { mode: "everyMutation" },
    )
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
    if (isMutation(sql)) {
      return await this.#executeSingleMutation(normalized, sql)
    }
    const result = execOn(this.#db, normalized, sql)
    const rows = toRows(result)
    const rowCount = rows.length > 0 ? rows.length : typeof result === "number" ? result : 0
    return { command: commandTag(sql, rowCount), rowCount, rows }
  }

  async transaction<T>(work: (transaction: GitDbTransaction) => Promise<T>): Promise<T> {
    return await this.#enqueueMutation(async () => {
      const baseSnapshot = snapshotFromDatabase(this.#db, this.#manifest.sequence)
      const transactionDb = databaseFromSnapshot(baseSnapshot)
      const transaction = new EngineTransaction(transactionDb)
      const value = await work(transaction)
      const mutations = transaction.mutations()
      if (mutations.length === 0) {
        return value
      }
      await this.#persistMany(mutations)
      this.#db = transactionDb
      if (this.#shouldPersistVisibleSnapshot()) {
        await this.#persistVisibleSnapshotBestEffort()
      }
      return value
    })
  }

  async #executeSingleMutation(normalizedSql: string, originalSql: string): Promise<SqlResult> {
    return await this.#enqueueMutation(async () => {
      const committedManifest = this.#manifest
      try {
        const result = execOn(this.#db, normalizedSql, originalSql)
        const rows = toRows(result)
        const rowCount = rows.length > 0 ? rows.length : typeof result === "number" ? result : 0
        await this.#persistMany([originalSql])
        if (this.#shouldPersistVisibleSnapshot()) {
          await this.#persistVisibleSnapshotBestEffort()
        }
        return { command: commandTag(originalSql, rowCount), rowCount, rows }
      } catch (error: unknown) {
        await this.#restoreCommittedState(committedManifest)
        throw error
      }
    })
  }

  getLastVisibleSnapshotError(): unknown | undefined {
    return this.#lastVisibleSnapshotError
  }

  async #restoreVisibleSnapshot(): Promise<boolean> {
    if (this.#store.readVisibleSnapshot === undefined) {
      return false
    }
    const snapshot = await this.#store.readVisibleSnapshot()
    if (snapshot === null) {
      return false
    }
    if (snapshot.sequence === undefined && this.#manifest.sequence > 0) {
      return false
    }
    if (snapshot.sequence !== undefined && snapshot.sequence !== this.#manifest.sequence) {
      return false
    }
    restoreSnapshot(this.#db, snapshot)
    return true
  }

  async #persistVisibleSnapshot(): Promise<void> {
    if (this.#store.writeVisibleSnapshot === undefined) {
      return
    }
    await this.#store.writeVisibleSnapshot(snapshotFromDatabase(this.#db, this.#manifest.sequence))
  }

  async #persistVisibleSnapshotBestEffort(): Promise<void> {
    try {
      await this.#persistVisibleSnapshot()
      this.#lastVisibleSnapshotError = undefined
    } catch (error: unknown) {
      this.#lastVisibleSnapshotError = error
    }
  }

  async #replay(): Promise<void> {
    const mutations = await this.#store.readMutations(this.#manifest.logSegments)
    for (const mutation of mutations) {
      execOn(this.#db, normalizePostgresSql(mutation.sql), mutation.sql)
    }
  }

  async #persistMany(sqlStatements: readonly string[]): Promise<void> {
    let sequence = this.#manifest.sequence
    const logSegments = [...this.#manifest.logSegments]
    let updatedAt = this.#manifest.updatedAt
    for (const sql of sqlStatements) {
      sequence += 1
      updatedAt = new Date().toISOString()
      const mutation = { at: updatedAt, sequence, sql } satisfies PersistedMutation
      const segment = await this.#store.appendMutation(mutation)
      logSegments.push(segment)
    }
    const nextManifest = {
      ...this.#manifest,
      logSegments,
      sequence,
      updatedAt,
    }
    await this.#store.writeManifest(nextManifest)
    this.#manifest = nextManifest
  }

  async #restoreCommittedState(manifest: GitDbManifest): Promise<void> {
    this.#manifest = manifest
    this.#db = createDatabase()
    const restoredSnapshot = await this.#restoreVisibleSnapshot()
    if (!restoredSnapshot) {
      await this.#replay()
    }
  }

  async #enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.#mutationQueue.then(operation, operation)
    this.#mutationQueue = queued.then(
      () => undefined,
      () => undefined,
    )
    return await queued
  }

  #shouldPersistVisibleSnapshot(): boolean {
    switch (this.#snapshotPolicy.mode) {
      case "everyMutation":
        return true
      case "interval":
        return this.#manifest.sequence % this.#snapshotPolicy.mutations === 0
      default:
        return assertNever(this.#snapshotPolicy)
    }
  }
}

function assertNever(value: never): never {
  throw new SqlExecutionError(
    "snapshot policy",
    `unexpected snapshot policy ${JSON.stringify(value)}`,
  )
}

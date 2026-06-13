import { z } from "zod"
import { GitDbOrmError } from "../errors.js"
import { GitDbEngine, type GitDbTransaction } from "../sql/engine.js"
import { sqlLiteral } from "../sql/rows.js"
import type { GitDbStore } from "../storage/store.js"
import type { JsonPrimitive, SqlRow } from "../types.js"

const GitDbColumnTypes = ["STRING", "INT", "FLOAT", "BOOL"] as const

export type GitDbColumnType = (typeof GitDbColumnTypes)[number]

export type EntityDefinition<Row extends object> = {
  readonly columns: { readonly [Key in Extract<keyof Row, string>]: GitDbColumnType }
  readonly primaryKey: Extract<keyof Row, string>
  readonly tableName: string
}

export type FindOptions<Row extends object> = {
  readonly where?: Partial<Record<Extract<keyof Row, string>, JsonPrimitive>>
}

export type GitDbDataSourceOptions<Row extends object> = {
  readonly entities: readonly EntityDefinition<Row>[]
  readonly store: GitDbStore
  readonly synchronize?: boolean
}

const EntityDefinitionSchema = z
  .object({
    columns: z.record(z.string().min(1), z.enum(GitDbColumnTypes)),
    primaryKey: z.string().min(1),
    tableName: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  })
  .refine((definition) => definition.primaryKey in definition.columns, {
    message: "primaryKey must exist in columns",
    path: ["primaryKey"],
  })

export function defineEntity<Row extends object>(
  definition: EntityDefinition<Row>,
): EntityDefinition<Row> {
  EntityDefinitionSchema.parse(definition)
  return definition
}

export async function createGitDbDataSource<Row extends object>(
  options: GitDbDataSourceOptions<Row>,
): Promise<GitDbDataSource> {
  const engine = await GitDbEngine.open({ store: options.store })
  const dataSource = new GitDbDataSource(engine)
  if (options.synchronize === true) {
    for (const entity of options.entities) {
      await dataSource.synchronize(entity)
    }
  }
  return dataSource
}

export class GitDbDataSource {
  readonly #engine: GitDbEngine

  constructor(engine: GitDbEngine) {
    this.#engine = engine
  }

  async query(sql: string): Promise<readonly SqlRow[]> {
    return (await this.#engine.execute(sql)).rows
  }

  getRepository<Row extends object>(entity: EntityDefinition<Row>): GitDbRepository<Row> {
    return new GitDbRepository(this.#engine, entity)
  }

  async synchronize<Row extends object>(entity: EntityDefinition<Row>): Promise<void> {
    await this.#engine.execute(createTableSql(entity))
  }

  async transaction<T>(work: (transaction: GitDbTransaction) => Promise<T>): Promise<T> {
    return await this.#engine.transaction(work)
  }
}

export class GitDbRepository<Row extends object> {
  readonly #engine: GitDbEngine
  readonly #entity: EntityDefinition<Row>

  constructor(engine: GitDbEngine, entity: EntityDefinition<Row>) {
    this.#engine = engine
    this.#entity = entity
  }

  async save(row: Row): Promise<void> {
    await this.#engine.transaction(async (transaction) => {
      await transaction.execute(deleteSql(this.#entity, primaryKeyWhere(this.#entity, row)))
      await transaction.execute(insertSql(this.#entity, row))
    })
  }

  async find(options: FindOptions<Row> = {}): Promise<readonly Row[]> {
    const result = await this.#engine.execute(selectSql(this.#entity, options.where ?? {}))
    return result.rows.map((row) => row as Row)
  }

  async findOne(options: FindOptions<Row>): Promise<Row | null> {
    const rows = await this.find(options)
    return rows[0] ?? null
  }

  async delete(where: FindOptions<Row>["where"]): Promise<number> {
    if (where === undefined || Object.keys(where).length === 0) {
      throw new GitDbOrmError("delete requires a non-empty where clause")
    }
    const result = await this.#engine.execute(deleteSql(this.#entity, where))
    return result.rowCount
  }
}

function createTableSql<Row extends object>(entity: EntityDefinition<Row>): string {
  const columns = Object.entries(entity.columns)
    .map(([name, type]) => `${identifier(name)} ${type}`)
    .join(", ")
  return `CREATE TABLE IF NOT EXISTS ${identifier(entity.tableName)} (${columns})`
}

function insertSql<Row extends object>(entity: EntityDefinition<Row>, row: Row): string {
  const columns = Object.keys(entity.columns)
  const names = columns.map(identifier).join(", ")
  const values = columns.map((column) => sqlLiteral(valueForKey(row, column))).join(", ")
  return `INSERT INTO ${identifier(entity.tableName)} (${names}) VALUES (${values})`
}

function selectSql<Row extends object>(
  entity: EntityDefinition<Row>,
  where: FindOptions<Row>["where"],
): string {
  const clause = whereClause(where)
  return `SELECT * FROM ${identifier(entity.tableName)}${clause}`
}

function deleteSql<Row extends object>(
  entity: EntityDefinition<Row>,
  where: FindOptions<Row>["where"],
): string {
  const clause = whereClause(where)
  if (clause.length === 0) {
    throw new GitDbOrmError("delete requires a non-empty where clause")
  }
  return `DELETE FROM ${identifier(entity.tableName)}${clause}`
}

function whereClause<Row extends object>(where: FindOptions<Row>["where"]): string {
  if (where === undefined || Object.keys(where).length === 0) {
    return ""
  }
  const parts = Object.entries(where).map(
    ([column, value]) => `${identifier(column)} = ${sqlLiteral(value)}`,
  )
  return ` WHERE ${parts.join(" AND ")}`
}

function identifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new GitDbOrmError(`invalid SQL identifier: ${value}`)
  }
  return value
}

function valueForKey<Row extends object>(row: Row, key: string): JsonPrimitive {
  const value: unknown = Reflect.get(row, key)
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }
  throw new GitDbOrmError(`entity value for ${key} must be a JSON primitive`)
}

function primaryKeyWhere<Row extends object>(
  entity: EntityDefinition<Row>,
  row: Row,
): Partial<Record<Extract<keyof Row, string>, JsonPrimitive>> {
  const where: Partial<Record<Extract<keyof Row, string>, JsonPrimitive>> = {}
  where[entity.primaryKey] = valueForKey(row, entity.primaryKey)
  return where
}

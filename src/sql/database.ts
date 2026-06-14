import alasql from "alasql"
import { z } from "zod"
import { SqlExecutionError } from "../errors.js"
import type { VisibleDatabaseSnapshot } from "../types.js"

export type AlaSqlDatabase = InstanceType<typeof alasql.Database>

const AlaSqlColumnSchema = z.object({
  columnid: z.string().min(1),
})

const AlaSqlTableSchema = z.object({
  columns: z.array(AlaSqlColumnSchema),
  data: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
})

const AlaSqlTablesSchema = z.record(z.string(), AlaSqlTableSchema)

let databaseCounter = 0

export function createDatabase(): AlaSqlDatabase {
  databaseCounter += 1
  return new alasql.Database(`gitdb_${databaseCounter}`)
}

export function databaseFromSnapshot(snapshot: VisibleDatabaseSnapshot): AlaSqlDatabase {
  const db = createDatabase()
  restoreSnapshot(db, snapshot)
  return db
}

export function snapshotFromDatabase(
  db: AlaSqlDatabase,
  sequence: number,
): VisibleDatabaseSnapshot {
  const parsed = AlaSqlTablesSchema.parse(db.tables)
  return {
    sequence,
    tables: Object.entries(parsed).map(([name, table]) => ({
      columns: table.columns.map((column) => column.columnid),
      name,
      rows: table.data,
    })),
  }
}

export function restoreSnapshot(db: AlaSqlDatabase, snapshot: VisibleDatabaseSnapshot): void {
  for (const table of snapshot.tables) {
    const columns = table.columns.map((column) => `${column} STRING`).join(", ")
    execOn(db, `CREATE TABLE IF NOT EXISTS ${table.name} (${columns})`, `restore ${table.name}`)
    for (const row of table.rows) {
      const values = table.columns.map((column) => sqlLiteral(row[column] ?? null)).join(", ")
      execOn(db, `INSERT INTO ${table.name} VALUES (${values})`, `restore ${table.name}`)
    }
  }
}

export function execOn(db: AlaSqlDatabase, normalizedSql: string, originalSql: string): unknown {
  try {
    return db.exec(normalizedSql)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new SqlExecutionError(originalSql, detail)
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

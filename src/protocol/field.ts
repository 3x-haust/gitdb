import type { FieldDesc } from "pg-server"
import { primitiveToWire } from "../sql/rows.js"
import type { SqlRow } from "../types.js"

const TEXT_OID = 25
const TEXT_SIZE = -1

export function describeRows(rows: readonly SqlRow[]): readonly FieldDesc[] {
  const first = rows[0]
  if (first === undefined) {
    return []
  }
  return Object.keys(first).map((name, index) => ({
    columnID: index + 1,
    dataTypeID: TEXT_OID,
    dataTypeModifier: -1,
    dataTypeSize: TEXT_SIZE,
    mode: "text",
    name,
    tableID: 0,
  }))
}

export function rowToWire(row: SqlRow, fields: readonly FieldDesc[]): readonly string[] {
  return fields.map((field) => primitiveToWire(row[field.name] ?? null) ?? "")
}

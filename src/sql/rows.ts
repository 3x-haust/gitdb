import { z } from "zod"
import type { JsonPrimitive, SqlRow } from "../types.js"

const PrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const RowSchema = z.record(z.string(), PrimitiveSchema)

export function toRows(value: unknown): readonly SqlRow[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((row) => RowSchema.parse(row))
}

export function primitiveToWire(value: JsonPrimitive): string | null {
  if (value === null) {
    return null
  }
  return String(value)
}

export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL"
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL"
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE"
  }
  return `'${String(value).replaceAll("'", "''")}'`
}

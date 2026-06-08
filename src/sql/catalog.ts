import type { SqlResult } from "../types.js"

const CATALOG_PATTERNS = [
  /current_database\s*\(/i,
  /current_schema\s*\(/i,
  /pg_catalog\./i,
  /information_schema\./i,
] as const

export function maybeCatalogResult(sql: string): SqlResult | null {
  const normalized = sql.trim()
  if (/^select\s+version\s*\(\s*\)/i.test(normalized)) {
    return {
      command: "SELECT",
      rowCount: 1,
      rows: [{ version: "GitDB PostgreSQL-compatible facade 0.1.0" }],
    }
  }
  if (/^select\s+current_database\s*\(\s*\)/i.test(normalized)) {
    return { command: "SELECT", rowCount: 1, rows: [{ current_database: "main" }] }
  }
  if (/^select\s+current_schema\s*\(\s*\)/i.test(normalized)) {
    return { command: "SELECT", rowCount: 1, rows: [{ current_schema: "public" }] }
  }
  if (CATALOG_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { command: "SELECT", rowCount: 0, rows: [] }
  }
  return null
}

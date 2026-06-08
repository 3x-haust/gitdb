import { sqlLiteral } from "../sql/rows.js"

export function bindParameters(sql: string, values: readonly unknown[]): string {
  return sql.replaceAll(/\$(\d+)/g, (_match: string, rawIndex: string) => {
    const parsed = Number.parseInt(rawIndex, 10)
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      return "NULL"
    }
    return sqlLiteral(values[parsed - 1])
  })
}

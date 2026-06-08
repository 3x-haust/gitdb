export function normalizePostgresSql(sql: string): string {
  return sql
    .replaceAll(/"/g, "")
    .replaceAll(/\bSERIAL\b/gi, "INT")
    .replaceAll(/\bBIGSERIAL\b/gi, "INT")
    .replaceAll(/\bTEXT\b/gi, "STRING")
    .replaceAll(/\bVARCHAR\s*\(\s*\d+\s*\)/gi, "STRING")
    .replaceAll(/\bBOOLEAN\b/gi, "BOOL")
    .replaceAll(/\bTIMESTAMPTZ\b/gi, "STRING")
    .replaceAll(/\bTIMESTAMP\b/gi, "STRING")
    .replaceAll(/\bJSONB\b/gi, "JSON")
    .replaceAll(/\bJSON\b/gi, "JSON")
}

export function commandTag(sql: string, rowCount: number): string {
  const verb = sql.trim().split(/\s+/)[0]?.toUpperCase() ?? "QUERY"
  switch (verb) {
    case "SELECT":
      return "SELECT"
    case "INSERT":
      return `INSERT 0 ${rowCount}`
    case "UPDATE":
      return `UPDATE ${rowCount}`
    case "DELETE":
      return `DELETE ${rowCount}`
    case "CREATE":
      return "CREATE"
    case "ALTER":
      return "ALTER"
    case "DROP":
      return "DROP"
    case "BEGIN":
      return "BEGIN"
    case "COMMIT":
      return "COMMIT"
    case "ROLLBACK":
      return "ROLLBACK"
    default:
      return verb
  }
}

export function isMutation(sql: string): boolean {
  return /^(create|alter|drop|insert|update|delete)\b/i.test(sql.trim())
}

export function isTransactionControl(sql: string): boolean {
  return /^(begin|commit|rollback)\b/i.test(sql.trim())
}

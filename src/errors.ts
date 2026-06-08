export class ConfigError extends Error {
  readonly name = "ConfigError"
}

export class CryptoKeyError extends Error {
  readonly name = "CryptoKeyError"
}

export class GitDbStorageError extends Error {
  readonly name = "GitDbStorageError"
}

export class SqlExecutionError extends Error {
  readonly name = "SqlExecutionError"

  constructor(
    readonly sql: string,
    readonly detail: string,
  ) {
    super(`SQL failed: ${detail}`)
  }
}

export class UnsupportedSqlError extends Error {
  readonly name = "UnsupportedSqlError"

  constructor(readonly sql: string) {
    super(`unsupported SQL statement: ${sql}`)
  }
}

export class ProtocolError extends Error {
  readonly name = "ProtocolError"
}

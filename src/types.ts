declare const brand: unique symbol

export type Brand<T, B extends string> = T & { readonly [brand]: B }

export type SegmentId = Brand<string, "SegmentId">
export type OpaquePath = Brand<string, "OpaquePath">

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export type SqlRow = Readonly<Record<string, JsonPrimitive>>

export type SqlResult = {
  readonly rows: readonly SqlRow[]
  readonly command: string
  readonly rowCount: number
}

export type PersistedMutation = {
  readonly sequence: number
  readonly sql: string
  readonly at: string
}

export type GitDbManifest = {
  readonly version: 1
  readonly sequence: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly logSegments: readonly SegmentId[]
}

export function segmentId(value: string): SegmentId {
  return value as SegmentId
}

export function opaquePath(value: string): OpaquePath {
  return value as OpaquePath
}

import type {
  GitDbManifest,
  PersistedMutation,
  SegmentId,
  VisibleDatabaseSnapshot,
} from "../types.js"

export interface GitDbStore {
  readManifest(): Promise<GitDbManifest | null>
  writeManifest(manifest: GitDbManifest): Promise<void>
  appendMutation(mutation: PersistedMutation): Promise<SegmentId>
  readMutations(segments: readonly SegmentId[]): Promise<readonly PersistedMutation[]>
  readVisibleSnapshot?(): Promise<VisibleDatabaseSnapshot | null>
  writeVisibleSnapshot?(snapshot: VisibleDatabaseSnapshot): Promise<void>
}

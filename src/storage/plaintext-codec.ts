import { z } from "zod"
import {
  type GitDbManifest,
  type PersistedMutation,
  type SegmentId,
  segmentId,
  type VisibleDatabaseSnapshot,
  type VisibleTableSnapshot,
} from "../types.js"

const ManifestSchema = z.object({
  version: z.literal(1),
  sequence: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  logSegments: z.array(z.string()),
})

const MutationSchema = z.object({
  sequence: z.number().int().positive(),
  sql: z.string(),
  at: z.string(),
})

const VisibleTableSnapshotSchema = z.object({
  name: z.string().min(1),
  columns: z.array(z.string().min(1)),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
})

const VisibleDatabaseSnapshotSchema = z.object({
  tables: z.array(VisibleTableSnapshotSchema),
})

export function parsePlaintextManifest(payload: string): GitDbManifest {
  const parsed = ManifestSchema.parse(JSON.parse(payload))
  return {
    ...parsed,
    logSegments: parsed.logSegments.map(segmentId),
  }
}

export function parsePlaintextMutation(payload: string): PersistedMutation {
  return MutationSchema.parse(JSON.parse(payload))
}

export function parseVisibleTableSnapshot(payload: string): VisibleTableSnapshot {
  return VisibleTableSnapshotSchema.parse(JSON.parse(payload))
}

export function parseVisibleDatabaseSnapshot(payload: string): VisibleDatabaseSnapshot {
  return VisibleDatabaseSnapshotSchema.parse(JSON.parse(payload))
}

export function stringifyPlaintext(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function segmentIdForSequence(sequence: number): SegmentId {
  return segmentId(sequence.toString().padStart(20, "0"))
}

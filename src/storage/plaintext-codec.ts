import { z } from "zod"
import { type GitDbManifest, type PersistedMutation, type SegmentId, segmentId } from "../types.js"

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

export function stringifyPlaintext(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function segmentIdForSequence(sequence: number): SegmentId {
  return segmentId(sequence.toString().padStart(20, "0"))
}

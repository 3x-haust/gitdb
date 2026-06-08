import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { z } from "zod"
import type { Cipher } from "../crypto/aes-gcm.js"
import { GitDbStorageError } from "../errors.js"
import { type GitDbManifest, type PersistedMutation, type SegmentId, segmentId } from "../types.js"
import type { GitDbStore } from "./store.js"

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

type LocalEncryptedStoreOptions = {
  readonly root: string
  readonly cipher: Cipher
}

export class LocalEncryptedStore implements GitDbStore {
  readonly #root: string
  readonly #cipher: Cipher

  constructor(options: LocalEncryptedStoreOptions) {
    this.#root = join(options.root, "gitdb", "v1")
    this.#cipher = options.cipher
  }

  async readManifest(): Promise<GitDbManifest | null> {
    const payload = await this.#readNullable(join(this.#root, "manifest.enc"))
    if (payload === null) {
      return null
    }
    const parsed = ManifestSchema.parse(JSON.parse(this.#cipher.open(payload).toString("utf8")))
    return {
      ...parsed,
      logSegments: parsed.logSegments.map(segmentId),
    }
  }

  async writeManifest(manifest: GitDbManifest): Promise<void> {
    await this.#writeEncrypted(join(this.#root, "manifest.enc"), manifest)
  }

  async appendMutation(mutation: PersistedMutation): Promise<SegmentId> {
    const id = segmentId(mutation.sequence.toString().padStart(20, "0"))
    await this.#writeEncrypted(join(this.#root, "log", `${id}.enc`), mutation)
    return id
  }

  async readMutations(segments: readonly SegmentId[]): Promise<readonly PersistedMutation[]> {
    const mutations: PersistedMutation[] = []
    for (const segment of segments) {
      const payload = await this.#readNullable(join(this.#root, "log", `${segment}.enc`))
      if (payload === null) {
        throw new GitDbStorageError(`missing mutation segment ${segment}`)
      }
      const parsed = MutationSchema.parse(JSON.parse(this.#cipher.open(payload).toString("utf8")))
      mutations.push(parsed)
    }
    return mutations
  }

  async #writeEncrypted(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const plaintext = Buffer.from(JSON.stringify(value), "utf8")
    await writeFile(path, this.#cipher.seal(plaintext), "utf8")
  }

  async #readNullable(path: string): Promise<string | null> {
    try {
      return await readFile(path, "utf8")
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null
      }
      throw error
    }
  }
}

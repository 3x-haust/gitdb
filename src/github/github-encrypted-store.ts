import { Octokit } from "@octokit/rest"
import { z } from "zod"
import type { Cipher } from "../crypto/aes-gcm.js"
import { GitDbStorageError } from "../errors.js"
import type { GitDbStore } from "../storage/store.js"
import { type GitDbManifest, type PersistedMutation, type SegmentId, segmentId } from "../types.js"
import { type GitHubConfig, GitHubFileSchema } from "./types.js"

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

type WriteFileInput = {
  readonly path: string
  readonly message: string
  readonly plaintext: unknown
}

export class GitHubEncryptedStore implements GitDbStore {
  readonly #octokit: Octokit
  readonly #config: GitHubConfig
  readonly #cipher: Cipher

  constructor(config: GitHubConfig, cipher: Cipher) {
    this.#octokit = new Octokit({ auth: config.token })
    this.#config = config
    this.#cipher = cipher
  }

  async readManifest(): Promise<GitDbManifest | null> {
    const payload = await this.#readNullable(`${this.#config.prefix}/manifest.enc`)
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
    await this.#writeFile({
      message: "gitdb sync manifest",
      path: `${this.#config.prefix}/manifest.enc`,
      plaintext: manifest,
    })
  }

  async appendMutation(mutation: PersistedMutation): Promise<SegmentId> {
    const id = segmentId(mutation.sequence.toString().padStart(20, "0"))
    await this.#writeFile({
      message: "gitdb sync segment",
      path: `${this.#config.prefix}/log/${id}.enc`,
      plaintext: mutation,
    })
    return id
  }

  async readMutations(segments: readonly SegmentId[]): Promise<readonly PersistedMutation[]> {
    const mutations: PersistedMutation[] = []
    for (const segment of segments) {
      const payload = await this.#readNullable(`${this.#config.prefix}/log/${segment}.enc`)
      if (payload === null) {
        throw new GitDbStorageError(`missing GitHub mutation segment ${segment}`)
      }
      mutations.push(MutationSchema.parse(JSON.parse(this.#cipher.open(payload).toString("utf8"))))
    }
    return mutations
  }

  async #readNullable(path: string): Promise<string | null> {
    try {
      const response = await this.#octokit.repos.getContent({
        owner: this.#config.owner,
        repo: this.#config.repo,
        path,
        ref: this.#config.branch,
      })
      const parsed = GitHubFileSchema.safeParse(response.data)
      if (!parsed.success) {
        throw new GitDbStorageError(`GitHub path is not a file: ${path}`)
      }
      return Buffer.from(parsed.data.content, "base64").toString("utf8")
    } catch (error) {
      if (isGitHubNotFound(error)) {
        return null
      }
      throw error
    }
  }

  async #writeFile(input: WriteFileInput): Promise<void> {
    const existing = await this.#getExistingSha(input.path)
    const sealed = this.#cipher.seal(Buffer.from(JSON.stringify(input.plaintext), "utf8"))
    const request = {
      branch: this.#config.branch,
      content: Buffer.from(sealed, "utf8").toString("base64"),
      message: input.message,
      owner: this.#config.owner,
      path: input.path,
      repo: this.#config.repo,
      ...(existing === null ? {} : { sha: existing }),
    }
    await this.#octokit.repos.createOrUpdateFileContents(request)
  }

  async #getExistingSha(path: string): Promise<string | null> {
    try {
      const response = await this.#octokit.repos.getContent({
        owner: this.#config.owner,
        repo: this.#config.repo,
        path,
        ref: this.#config.branch,
      })
      const parsed = GitHubFileSchema.safeParse(response.data)
      if (!parsed.success) {
        throw new GitDbStorageError(`GitHub path is not a file: ${path}`)
      }
      return parsed.data.sha
    } catch (error) {
      if (isGitHubNotFound(error)) {
        return null
      }
      throw error
    }
  }
}

function isGitHubNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status === 404
  )
}

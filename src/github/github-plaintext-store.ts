import { Octokit } from "@octokit/rest"
import { GitDbStorageError } from "../errors.js"
import {
  parsePlaintextManifest,
  parsePlaintextMutation,
  segmentIdForSequence,
  stringifyPlaintext,
} from "../storage/plaintext-codec.js"
import type { GitDbStore } from "../storage/store.js"
import type { GitDbManifest, PersistedMutation, SegmentId } from "../types.js"
import { type GitHubConfig, GitHubFileSchema } from "./types.js"

type WriteFileInput = {
  readonly path: string
  readonly message: string
  readonly plaintext: unknown
}

export class GitHubPlaintextStore implements GitDbStore {
  readonly #octokit: Octokit
  readonly #config: GitHubConfig

  constructor(config: GitHubConfig) {
    this.#octokit = new Octokit({ auth: config.token })
    this.#config = config
  }

  async readManifest(): Promise<GitDbManifest | null> {
    const payload = await this.#readNullable(`${this.#config.prefix}/manifest.json`)
    return payload === null ? null : parsePlaintextManifest(payload)
  }

  async writeManifest(manifest: GitDbManifest): Promise<void> {
    await this.#writeFile({
      message: "gitdb sync plaintext manifest",
      path: `${this.#config.prefix}/manifest.json`,
      plaintext: manifest,
    })
  }

  async appendMutation(mutation: PersistedMutation): Promise<SegmentId> {
    const id = segmentIdForSequence(mutation.sequence)
    await this.#writeFile({
      message: "gitdb sync plaintext segment",
      path: `${this.#config.prefix}/log/${id}.json`,
      plaintext: mutation,
    })
    return id
  }

  async readMutations(segments: readonly SegmentId[]): Promise<readonly PersistedMutation[]> {
    const mutations: PersistedMutation[] = []
    for (const segment of segments) {
      const payload = await this.#readNullable(`${this.#config.prefix}/log/${segment}.json`)
      if (payload === null) {
        throw new GitDbStorageError(`missing GitHub plaintext mutation segment ${segment}`)
      }
      mutations.push(parsePlaintextMutation(payload))
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
    const request = {
      branch: this.#config.branch,
      content: Buffer.from(stringifyPlaintext(input.plaintext), "utf8").toString("base64"),
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

import { Octokit } from "@octokit/rest"
import { GitDbStorageError } from "../errors.js"
import {
  parsePlaintextManifest,
  parsePlaintextMutation,
  parseVisibleTableRows,
  parseVisibleTableSchema,
  segmentIdForSequence,
  stringifyPlaintext,
} from "../storage/plaintext-codec.js"
import type { GitDbStore } from "../storage/store.js"
import type {
  GitDbManifest,
  PersistedMutation,
  SegmentId,
  VisibleDatabaseSnapshot,
} from "../types.js"
import {
  gitHubWriteError,
  isGitHubConflict,
  isGitHubNotFound,
  isGitHubTransient,
} from "./errors.js"
import { ensureGitHubRepository } from "./repository.js"
import { type GitHubConfig, GitHubDirectoryEntrySchema, GitHubFileSchema } from "./types.js"

type WriteFileInput = {
  readonly path: string
  readonly message: string
  readonly plaintext: unknown
}

const GITHUB_API_VERSION = "2022-11-28"

export class GitHubPlaintextStore implements GitDbStore {
  readonly #octokit: Octokit
  readonly #config: GitHubConfig

  constructor(config: GitHubConfig) {
    this.#octokit = new Octokit({
      auth: config.token,
      request: {
        headers: {
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
      },
    })
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

  async readVisibleSnapshot(): Promise<VisibleDatabaseSnapshot | null> {
    const tableNames = await this.#readTableNames()
    const tables = []
    for (const tableName of tableNames) {
      const schemaPayload = await this.#readNullable(
        `${this.#config.prefix}/${tableName}/schema.json`,
      )
      const dataPayload = await this.#readNullable(`${this.#config.prefix}/${tableName}/data.json`)
      if (schemaPayload !== null && dataPayload !== null) {
        const schema = parseVisibleTableSchema(schemaPayload)
        tables.push({
          ...schema,
          rows: parseVisibleTableRows(dataPayload),
        })
      }
    }
    return tables.length === 0 ? null : { tables }
  }

  async writeVisibleSnapshot(snapshot: VisibleDatabaseSnapshot): Promise<void> {
    for (const table of snapshot.tables) {
      await this.#writeFile({
        message: `gitdb sync ${table.name} schema`,
        path: `${this.#config.prefix}/${table.name}/schema.json`,
        plaintext: {
          columns: table.columns,
          name: table.name,
        },
      })
      await this.#writeFile({
        message: `gitdb sync ${table.name} data`,
        path: `${this.#config.prefix}/${table.name}/data.json`,
        plaintext: table.rows,
      })
    }
  }

  async #readTableNames(): Promise<readonly string[]> {
    try {
      const response = await this.#octokit.repos.getContent({
        owner: this.#config.owner,
        path: this.#config.prefix,
        ref: this.#config.branch,
        repo: this.#config.repo,
      })
      if (!Array.isArray(response.data)) {
        return []
      }
      return response.data
        .map((entry) => GitHubDirectoryEntrySchema.safeParse(entry))
        .filter((entry) => entry.success)
        .map((entry) => entry.data)
        .filter((entry) => entry.type === "dir" && entry.name !== "log")
        .map((entry) => entry.name)
    } catch (error) {
      if (isGitHubNotFound(error)) {
        return []
      }
      throw error
    }
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
    let repositoryBootstrapped = false
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await this.#getExistingSha(input.path)
      const request = this.#writeRequest(input, existing)
      try {
        await this.#octokit.repos.createOrUpdateFileContents(request)
        return
      } catch (error) {
        if (isGitHubNotFound(error) && !repositoryBootstrapped) {
          await ensureGitHubRepository(this.#octokit, this.#config)
          repositoryBootstrapped = true
          continue
        }
        if (isGitHubConflict(error)) {
          continue
        }
        if (isGitHubTransient(error)) {
          await sleep(500 * (attempt + 1))
          continue
        }
        throw this.#writeError(input.path, error)
      }
    }
    throw new GitDbStorageError(
      `GitHub write conflict did not settle for ${this.#config.owner}/${this.#config.repo}@${this.#config.branch}:${input.path}`,
    )
  }

  #writeRequest(
    input: WriteFileInput,
    existing: string | null,
  ): Parameters<Octokit["repos"]["createOrUpdateFileContents"]>[0] {
    return {
      branch: this.#config.branch,
      content: Buffer.from(stringifyPlaintext(input.plaintext), "utf8").toString("base64"),
      message: input.message,
      owner: this.#config.owner,
      path: input.path,
      repo: this.#config.repo,
      ...(existing === null ? {} : { sha: existing }),
    }
  }

  #writeError(path: string, error: unknown): unknown {
    const writeError = gitHubWriteError(this.#config, path, error)
    return writeError ?? error
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

import { z } from "zod"
import { GitDbStorageError } from "../errors.js"
import { githubStatus, isGitHubAlreadyExists, isGitHubNotFound } from "./errors.js"
import type { GitHubConfig } from "./types.js"

const AuthenticatedUserSchema = z.object({
  login: z.string().min(1),
})

const RepositorySchema = z.object({
  default_branch: z.string().min(1),
})

const GitRefSchema = z.object({
  object: z.object({
    sha: z.string().min(1),
  }),
})

type GitHubResponse = {
  readonly data: unknown
}

type GitHubRepositoryClient = {
  readonly users: {
    readonly getAuthenticated: () => Promise<GitHubResponse>
  }
  readonly repos: {
    readonly get: (input: {
      readonly owner: string
      readonly repo: string
    }) => Promise<GitHubResponse>
    readonly getBranch: (input: {
      readonly owner: string
      readonly repo: string
      readonly branch: string
    }) => Promise<GitHubResponse>
    readonly createForAuthenticatedUser: (input: {
      readonly name: string
      readonly private: boolean
      readonly auto_init: boolean
      readonly description: string
    }) => Promise<GitHubResponse>
    readonly createInOrg: (input: {
      readonly org: string
      readonly name: string
      readonly private: boolean
      readonly auto_init: boolean
      readonly description: string
    }) => Promise<GitHubResponse>
  }
  readonly git: {
    readonly getRef: (input: {
      readonly owner: string
      readonly repo: string
      readonly ref: string
    }) => Promise<GitHubResponse>
    readonly createRef: (input: {
      readonly owner: string
      readonly repo: string
      readonly ref: string
      readonly sha: string
    }) => Promise<GitHubResponse>
  }
}

type RepositoryState = {
  readonly defaultBranch: string
}

export async function ensureGitHubRepository(
  client: GitHubRepositoryClient,
  config: GitHubConfig,
): Promise<void> {
  const repository =
    (await getRepository(client, config)) ?? (await createPublicRepository(client, config))
  await ensureBranch(client, config, repository.defaultBranch)
}

async function getRepository(
  client: GitHubRepositoryClient,
  config: GitHubConfig,
): Promise<RepositoryState | null> {
  try {
    const response = await client.repos.get({
      owner: config.owner,
      repo: config.repo,
    })
    return parseRepository(response.data)
  } catch (error) {
    if (isGitHubNotFound(error)) {
      return null
    }
    throw error
  }
}

async function createPublicRepository(
  client: GitHubRepositoryClient,
  config: GitHubConfig,
): Promise<RepositoryState> {
  const user = AuthenticatedUserSchema.parse((await client.users.getAuthenticated()).data)
  try {
    const response =
      user.login === config.owner
        ? await client.repos.createForAuthenticatedUser({
            auto_init: true,
            description: "GitDB database repository",
            name: config.repo,
            private: false,
          })
        : await client.repos.createInOrg({
            auto_init: true,
            description: "GitDB database repository",
            name: config.repo,
            org: config.owner,
            private: false,
          })
    return parseRepository(response.data)
  } catch (error) {
    if (isGitHubAlreadyExists(error)) {
      const repository = await getRepository(client, config)
      if (repository !== null) {
        return repository
      }
    }
    throw repositoryCreateError(config, error)
  }
}

async function ensureBranch(
  client: GitHubRepositoryClient,
  config: GitHubConfig,
  defaultBranch: string,
): Promise<void> {
  try {
    await client.repos.getBranch({
      branch: config.branch,
      owner: config.owner,
      repo: config.repo,
    })
  } catch (error) {
    if (!isGitHubNotFound(error)) {
      throw error
    }
    const response = await client.git.getRef({
      owner: config.owner,
      ref: `heads/${defaultBranch}`,
      repo: config.repo,
    })
    const parsed = GitRefSchema.parse(response.data)
    try {
      await client.git.createRef({
        owner: config.owner,
        ref: `refs/heads/${config.branch}`,
        repo: config.repo,
        sha: parsed.object.sha,
      })
    } catch (createError) {
      if (isGitHubAlreadyExists(createError)) {
        return
      }
      throw createError
    }
  }
}

function parseRepository(data: unknown): RepositoryState {
  const parsed = RepositorySchema.parse(data)
  return { defaultBranch: parsed.default_branch }
}

function repositoryCreateError(config: GitHubConfig, error: unknown): GitDbStorageError {
  const status = githubStatus(error)
  const suffix = status === null ? "" : ` GitHub status: ${status}.`
  return new GitDbStorageError(
    [
      `GitDB could not create public database repo ${config.owner}/${config.repo}.`,
      "Create the repo manually, or use a token allowed to create repositories for that owner.",
      "For organization owners, the token user must be allowed to create repositories in the organization.",
      suffix,
    ].join(" "),
  )
}

import { z } from "zod"
import { GitDbStorageError } from "../errors.js"
import type { GitHubConfig } from "./types.js"

const GitHubStatusErrorSchema = z.object({
  status: z.number().int(),
})

export function isGitHubNotFound(error: unknown): boolean {
  return githubStatus(error) === 404
}

export function isGitHubAlreadyExists(error: unknown): boolean {
  return githubStatus(error) === 422
}

export function isGitHubConflict(error: unknown): boolean {
  return githubStatus(error) === 409
}

export function isGitHubTransient(error: unknown): boolean {
  const status = githubStatus(error)
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

export function gitHubWriteError(
  config: GitHubConfig,
  path: string,
  error: unknown,
): GitDbStorageError | null {
  const status = githubStatus(error)
  if (status === 404) {
    return new GitDbStorageError(
      [
        `GitHub database repo ${config.owner}/${config.repo}@${config.branch} is not writable with GITDB_GITHUB_TOKEN while writing ${path}.`,
        "Check that the repository exists, the branch exists, and the token is granted to this repository with Contents: Read and write.",
        "GitHub returns 404 for private or unauthorized repositories.",
        "For local-only example mode, leave GITDB_GITHUB_TOKEN blank.",
      ].join(" "),
    )
  }
  if (status === 403) {
    return new GitDbStorageError(
      [
        `GitHub database repo ${config.owner}/${config.repo}@${config.branch} rejected the write to ${path}.`,
        "Check the token contents permission, organization SSO authorization, and GitHub rate-limit state.",
      ].join(" "),
    )
  }
  return null
}

export function githubStatus(error: unknown): number | null {
  const parsed = GitHubStatusErrorSchema.safeParse(error)
  return parsed.success ? parsed.data.status : null
}

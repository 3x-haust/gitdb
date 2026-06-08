import { describe, expect, it } from "vitest"
import { GitDbStorageError } from "../src/errors.js"
import { gitHubWriteError, isGitHubConflict, isGitHubNotFound } from "../src/github/errors.js"
import type { GitHubConfig } from "../src/github/types.js"

class FakeGitHubStatusError extends Error {
  constructor(readonly status: number) {
    super(`GitHub status ${status}`)
  }
}

const config: GitHubConfig = {
  branch: "main",
  owner: "3x-haust",
  prefix: "gitdb/v1",
  repo: "gitdb-example-db",
  token: "redacted-token",
}

describe("GitHub error handling", () => {
  it("treats GitHub 404 as not found for reads", () => {
    // Given: GitHub returned its opaque not-found status.
    const error = new FakeGitHubStatusError(404)

    // When: GitDB classifies the error for a nullable read.
    const result = isGitHubNotFound(error)

    // Then: the store can treat a missing manifest as a first-run state.
    expect(result).toBe(true)
  })

  it("explains GitHub 404 writes as repository or token access failures", () => {
    // Given: GitHub returned 404 while creating the database manifest.
    const error = new FakeGitHubStatusError(404)

    // When: GitDB converts the provider error for a write path.
    const result = gitHubWriteError(config, "gitdb/v1/manifest.json", error)

    // Then: the user gets an actionable GitDB error instead of a raw Octokit stack.
    expect(result).toBeInstanceOf(GitDbStorageError)
    expect(result?.message).toContain("3x-haust/gitdb-example-db@main")
    expect(result?.message).toContain("Contents: Read and write")
    expect(result?.message).toContain("leave GITDB_GITHUB_TOKEN blank")
  })

  it("treats GitHub 409 as a retryable write conflict", () => {
    // Given: GitHub rejected a contents write because the sha was stale.
    const error = new FakeGitHubStatusError(409)

    // When: GitDB classifies the provider error.
    const result = isGitHubConflict(error)

    // Then: stores can refetch the latest sha and retry the write.
    expect(result).toBe(true)
  })
})

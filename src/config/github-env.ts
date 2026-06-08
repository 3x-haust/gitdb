import { type GitHubConfig, GitHubConfigSchema } from "../github/types.js"

export function parseGitHubEnv(env: NodeJS.ProcessEnv): GitHubConfig | null {
  if (
    isBlank(env["GITDB_GITHUB_OWNER"]) ||
    isBlank(env["GITDB_GITHUB_REPO"]) ||
    isBlank(env["GITDB_GITHUB_TOKEN"])
  ) {
    return null
  }
  return GitHubConfigSchema.parse({
    branch: env["GITDB_GITHUB_BRANCH"] ?? "main",
    owner: env["GITDB_GITHUB_OWNER"],
    prefix: env["GITDB_GITHUB_PREFIX"] ?? "gitdb/v1",
    repo: env["GITDB_GITHUB_REPO"],
    token: env["GITDB_GITHUB_TOKEN"],
  })
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0
}

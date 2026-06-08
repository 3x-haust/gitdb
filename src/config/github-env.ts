import { type GitHubConfig, GitHubConfigSchema } from "../github/types.js"

export function parseGitHubEnv(env: NodeJS.ProcessEnv): GitHubConfig | null {
  if (
    env["GITDB_GITHUB_OWNER"] === undefined ||
    env["GITDB_GITHUB_REPO"] === undefined ||
    env["GITDB_GITHUB_TOKEN"] === undefined
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

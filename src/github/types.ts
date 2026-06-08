import { z } from "zod"

export const GitHubConfigSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().min(1).default("main"),
  token: z.string().min(1),
  prefix: z.string().min(1).default("gitdb/v1"),
})

export type GitHubConfig = z.infer<typeof GitHubConfigSchema>

export const GitHubFileSchema = z.object({
  content: z.string(),
  sha: z.string(),
})

export type GitHubFile = z.infer<typeof GitHubFileSchema>

import { z } from "zod"
import { ConfigError } from "../errors.js"

const EnvSchema = z.object({
  GITDB_KEY: z.string().min(1),
  GITDB_ROOT: z.string().default(".gitdb"),
  GITDB_HOST: z.string().default("127.0.0.1"),
  GITDB_PORT: z.coerce.number().int().min(0).max(65_535).default(7432),
})

export type GitDbEnv = z.infer<typeof EnvSchema>

export function parseEnv(env: NodeJS.ProcessEnv): GitDbEnv {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    throw new ConfigError(parsed.error.message)
  }
  return parsed.data
}

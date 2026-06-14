import { z } from "zod"
import { ConfigError } from "../errors.js"

const EnvSchema = z.object({
  GITDB_ENCRYPTION: z.enum(["on", "off"]).default("on"),
  GITDB_KEY: z.string().min(1).optional(),
  GITDB_ROOT: z.string().default(".gitdb"),
})

export type GitDbEnv = z.infer<typeof EnvSchema>

export function parseEnv(env: NodeJS.ProcessEnv): GitDbEnv {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    throw new ConfigError(parsed.error.message)
  }
  if (parsed.data.GITDB_ENCRYPTION === "on" && parsed.data.GITDB_KEY === undefined) {
    throw new ConfigError("GITDB_KEY is required when GITDB_ENCRYPTION=on")
  }
  return parsed.data
}

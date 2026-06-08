import { parseEnv } from "../config/env.js"
import { parseGitHubEnv } from "../config/github-env.js"
import { createAesGcmCipher } from "../crypto/aes-gcm.js"
import { GitHubEncryptedStore } from "../github/github-encrypted-store.js"
import { GitHubPlaintextStore } from "../github/github-plaintext-store.js"
import { LocalEncryptedStore } from "../storage/local-encrypted-store.js"
import { LocalPlaintextStore } from "../storage/local-plaintext-store.js"
import type { GitDbStore } from "../storage/store.js"

export type StoreMode = "github" | "github-plaintext" | "local" | "local-plaintext"

export type StoreFactoryResult = {
  readonly env: ReturnType<typeof parseEnv>
  readonly mode: StoreMode
  readonly store: GitDbStore
}

export function createStoreFromEnv(envSource: NodeJS.ProcessEnv): StoreFactoryResult {
  const env = parseEnv(envSource)
  const github = parseGitHubEnv(envSource)
  if (env.GITDB_ENCRYPTION === "off") {
    if (github !== null) {
      return {
        env,
        mode: "github-plaintext",
        store: new GitHubPlaintextStore(github),
      }
    }
    return {
      env,
      mode: "local-plaintext",
      store: new LocalPlaintextStore({ root: env.GITDB_ROOT }),
    }
  }
  if (env.GITDB_KEY === undefined) {
    throw new Error("GITDB_KEY is required when GITDB_ENCRYPTION=on")
  }
  const cipher = createAesGcmCipher(env.GITDB_KEY)
  if (github !== null) {
    return {
      env,
      mode: "github",
      store: new GitHubEncryptedStore(github, cipher),
    }
  }
  return {
    env,
    mode: "local",
    store: new LocalEncryptedStore({ cipher, root: env.GITDB_ROOT }),
  }
}

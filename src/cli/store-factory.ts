import { parseEnv } from "../config/env.js"
import { parseGitHubEnv } from "../config/github-env.js"
import { createAesGcmCipher } from "../crypto/aes-gcm.js"
import { GitHubEncryptedStore } from "../github/github-encrypted-store.js"
import { LocalEncryptedStore } from "../storage/local-encrypted-store.js"
import type { GitDbStore } from "../storage/store.js"

export type StoreFactoryResult = {
  readonly env: ReturnType<typeof parseEnv>
  readonly mode: "github" | "local"
  readonly store: GitDbStore
}

export function createStoreFromEnv(envSource: NodeJS.ProcessEnv): StoreFactoryResult {
  const env = parseEnv(envSource)
  const cipher = createAesGcmCipher(env.GITDB_KEY)
  const github = parseGitHubEnv(envSource)
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

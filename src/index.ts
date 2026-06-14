export { generateKey } from "./cli/keygen.js"
export { createAesGcmCipher } from "./crypto/aes-gcm.js"
export { GitHubEncryptedStore } from "./github/github-encrypted-store.js"
export {
  createGitDbDataSource,
  defineEntity,
  type EntityDefinition,
  type FindOptions,
  type GitDbColumnType,
  GitDbDataSource,
  type GitDbDataSourceOptions,
  type GitDbEntityDefinition,
  GitDbRepository,
} from "./orm/index.js"
export { GitDbEngine, type GitDbTransaction } from "./sql/engine.js"
export { LocalEncryptedStore } from "./storage/local-encrypted-store.js"
export { LocalPlaintextStore } from "./storage/local-plaintext-store.js"
export type { GitDbStore } from "./storage/store.js"
export type { GitDbManifest, PersistedMutation, SqlResult, SqlRow } from "./types.js"

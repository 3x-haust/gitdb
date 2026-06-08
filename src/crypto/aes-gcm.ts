import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto"
import { CryptoKeyError } from "../errors.js"
import { type OpaquePath, opaquePath } from "../types.js"

export type Cipher = {
  readonly seal: (plaintext: Buffer) => string
  readonly open: (payload: string) => Buffer
  readonly opaquePath: (logicalPath: string) => OpaquePath
}

const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16

export function createAesGcmCipher(base64UrlKey: string): Cipher {
  const key = Buffer.from(base64UrlKey, "base64url")
  if (key.length !== KEY_BYTES) {
    throw new CryptoKeyError("GITDB_KEY must be a base64url encoded 32-byte key")
  }

  return {
    seal(plaintext: Buffer): string {
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv("aes-256-gcm", key, iv)
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
      const tag = cipher.getAuthTag()
      return Buffer.concat([iv, tag, encrypted]).toString("base64url")
    },
    open(payload: string): Buffer {
      const packed = Buffer.from(payload, "base64url")
      const iv = packed.subarray(0, IV_BYTES)
      const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
      const encrypted = packed.subarray(IV_BYTES + TAG_BYTES)
      const decipher = createDecipheriv("aes-256-gcm", key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(encrypted), decipher.final()])
    },
    opaquePath(logicalPath: string): OpaquePath {
      const digest = createHmac("sha256", key).update(logicalPath).digest("hex")
      return opaquePath(`${digest.slice(0, 2)}/${digest.slice(2, 4)}/${digest}.enc`)
    },
  }
}

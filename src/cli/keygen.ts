import { randomBytes } from "node:crypto"

export function generateKey(): string {
  return randomBytes(32).toString("base64url")
}

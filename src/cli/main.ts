#!/usr/bin/env node
import { Command } from "commander"
import pino from "pino"
import { GitDbEngine } from "../sql/engine.js"
import { generateKey } from "./keygen.js"
import { createStoreFromEnv } from "./store-factory.js"

const logger = pino({ level: process.env["LOG_LEVEL"] ?? "info" })

const program = new Command()
  .name("gitdb")
  .description("GitHub-native database runtime with local execution and auditable storage")
  .version("0.1.0")

program
  .command("keygen")
  .description("Generate a base64url 32-byte GitDB encryption key")
  .action(() => {
    process.stdout.write(`${generateKey()}\n`)
  })

program
  .command("query")
  .description("Execute one GitDB SQL statement against the configured store")
  .argument("<sql...>", "SQL statement")
  .action(async (sqlParts: readonly string[]) => {
    const { store } = createStoreFromEnv(process.env)
    const engine = await GitDbEngine.open({ store })
    const result = await engine.execute(sqlParts.join(" "))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  })

program
  .command("check")
  .description("Open the configured store and verify manifest access")
  .action(async () => {
    const { mode, store } = createStoreFromEnv(process.env)
    const manifest = await store.readManifest()
    process.stdout.write(
      JSON.stringify({ mode, sequence: manifest?.sequence ?? 0, status: "ok" }, null, 2),
    )
    process.stdout.write("\n")
  })

async function main(): Promise<void> {
  await program.parseAsync(process.argv)
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    logger.error({ error: error.message, stack: error.stack }, "gitdb failed")
    process.stderr.write(`${error.stack ?? error.message}\n`)
    process.exitCode = 1
    return
  }
  logger.error({ error: String(error) }, "gitdb failed")
  process.stderr.write(`${String(error)}\n`)
  process.exitCode = 1
})

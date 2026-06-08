#!/usr/bin/env node
import { Command } from "commander"
import pino from "pino"
import { createGitDbServer } from "../protocol/postgres-server.js"
import { GitDbEngine } from "../sql/engine.js"
import { generateKey } from "./keygen.js"
import { createStoreFromEnv } from "./store-factory.js"

const logger = pino({ level: process.env["LOG_LEVEL"] ?? "info" })

const program = new Command()
  .name("gitdb")
  .description("GitHub-native encrypted database with a PostgreSQL-compatible facade")
  .version("0.1.0")

program
  .command("keygen")
  .description("Generate a base64url 32-byte GitDB encryption key")
  .action(() => {
    process.stdout.write(`${generateKey()}\n`)
  })

program
  .command("serve")
  .description("Start the PostgreSQL-compatible facade")
  .option("--host <host>", "host to bind")
  .option("--port <port>", "port to bind")
  .action(async (options: { readonly host?: string; readonly port?: string }) => {
    const { env, mode, store } = createStoreFromEnv(process.env)
    const engine = await GitDbEngine.open({ store })
    const port = options.port === undefined ? env.GITDB_PORT : Number.parseInt(options.port, 10)
    const host = options.host ?? env.GITDB_HOST
    const server = await createGitDbServer({ engine, host, port })
    logger.info(
      {
        host: server.host,
        mode,
        port: server.port,
      },
      "gitdb postgres facade listening",
    )
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
    process.exitCode = 1
    return
  }
  logger.error({ error: String(error) }, "gitdb failed")
  process.exitCode = 1
})

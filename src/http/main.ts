import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import pino from "pino"
import { AppModule } from "./app.module.js"
import { gitDbRuntime } from "./gitdb.runtime.js"

const logger = pino({ level: process.env["LOG_LEVEL"] ?? "info" })

async function bootstrap(): Promise<void> {
  await gitDbRuntime.start()
  const app = await NestFactory.create(AppModule, { logger: false })
  const httpPort = Number.parseInt(process.env["PORT"] ?? "3000", 10)
  await app.listen(httpPort, "0.0.0.0")
  logger.info({ httpPort }, "gitdb control plane listening")
}

bootstrap().catch((error: unknown) => {
  if (error instanceof Error) {
    logger.error({ error: error.message, stack: error.stack }, "gitdb http service failed")
    process.stderr.write(`${error.stack ?? error.message}\n`)
    process.exitCode = 1
    return
  }
  logger.error({ error: String(error) }, "gitdb http service failed")
  process.stderr.write(`${String(error)}\n`)
  process.exitCode = 1
})

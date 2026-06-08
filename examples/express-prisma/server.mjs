import { PrismaPg } from "@prisma/adapter-pg"
import { config as loadEnv } from "dotenv"
import express from "express"
import { createStoreFromEnv } from "../../dist/src/cli/store-factory.js"
import { createGitDbServer } from "../../dist/src/protocol/postgres-server.js"
import { GitDbEngine } from "../../dist/src/sql/engine.js"
import { PrismaClient } from "./generated/client/index.js"

const envFile = {}
loadEnv({ path: new URL(".env", import.meta.url), processEnv: envFile })

const env = {
  ...envFile,
  ...process.env,
  GITDB_ENCRYPTION: process.env.GITDB_ENCRYPTION ?? envFile.GITDB_ENCRYPTION ?? "off",
  GITDB_HOST: process.env.GITDB_HOST ?? envFile.GITDB_HOST ?? "127.0.0.1",
  GITDB_PORT: process.env.GITDB_PORT ?? envFile.GITDB_PORT ?? "0",
  GITDB_ROOT: process.env.GITDB_ROOT ?? envFile.GITDB_ROOT ?? ".gitdb-example-public",
}

const { mode, store } = createStoreFromEnv(env)
const engine = await GitDbEngine.open({ store })
const server = await createGitDbServer({
  engine,
  host: env.GITDB_HOST,
  port: Number.parseInt(env.GITDB_PORT, 10),
})
const databaseUrl = `postgresql://token@${server.host}:${server.port}/main`
const adapter = new PrismaPg({ connectionString: databaseUrl })

const prisma = new PrismaClient({
  adapter,
})
const app = express()
const apiPort = Number.parseInt(process.env.API_PORT ?? envFile.API_PORT ?? "3090", 10)

app.use(express.json())

await prisma.$executeRawUnsafe("CREATE TABLE IF NOT EXISTS teams (id STRING, name STRING)")
await prisma.$executeRawUnsafe(
  "CREATE TABLE IF NOT EXISTS people (id STRING, name STRING, team_id STRING)",
)

app.get("/health", (_request, response) => {
  response.json({ databaseUrl, mode, status: "ready" })
})

app.post("/seed", async (_request, response) => {
  await prisma.$executeRawUnsafe("DELETE FROM people")
  await prisma.$executeRawUnsafe("DELETE FROM teams")
  await prisma.$executeRawUnsafe("INSERT INTO teams VALUES ('t1', 'Storage')")
  await prisma.$executeRawUnsafe("INSERT INTO teams VALUES ('t2', 'Runtime')")
  await prisma.$executeRawUnsafe("INSERT INTO people VALUES ('p1', 'Lin', 't1')")
  await prisma.$executeRawUnsafe("INSERT INTO people VALUES ('p2', 'Ada', 't2')")
  response.status(201).json({ inserted: 4 })
})

app.get("/people", async (_request, response) => {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT people.name AS person, teams.name AS team
    FROM people
    JOIN teams ON people.team_id = teams.id
    ORDER BY people.name
  `)
  response.json({ rows })
})

const httpServer = app.listen(apiPort, "127.0.0.1", () => {
  process.stdout.write(`Express API: http://127.0.0.1:${apiPort}\n`)
  process.stdout.write(`GitDB facade: ${databaseUrl}\n`)
  process.stdout.write(`GitDB mode: ${mode}\n`)
  process.stdout.write(`Try: curl -X POST http://127.0.0.1:${apiPort}/seed\n`)
  process.stdout.write(`Try: curl http://127.0.0.1:${apiPort}/people\n`)
})

async function shutdown() {
  await prisma.$disconnect()
  await server.close()
  await new Promise((resolve, reject) => {
    httpServer.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

process.on("SIGINT", () => {
  void shutdown().finally(() => {
    process.exit(0)
  })
})

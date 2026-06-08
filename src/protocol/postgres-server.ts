import type { Server } from "node:net"
import {
  CommandCode,
  createAdvancedServer,
  type DbRawCommand,
  type IAdvanceServerSession,
  type IResponseWriter,
} from "pg-server"
import { ProtocolError, SqlExecutionError } from "../errors.js"
import type { GitDbEngine } from "../sql/engine.js"
import { commandTag } from "../sql/normalize.js"
import { describeRows, rowToWire } from "./field.js"
import { bindParameters } from "./parameters.js"

export type GitDbServer = {
  readonly host: string
  readonly port: number
  readonly close: () => Promise<void>
}

type ServerOptions = {
  readonly engine: GitDbEngine
  readonly host: string
  readonly port: number
}

type PreparedStatement = {
  readonly sql: string
}

type Portal = {
  readonly sql: string
}

export async function createGitDbServer(options: ServerOptions): Promise<GitDbServer> {
  const server = createAdvancedServer(
    class GitDbSession implements IAdvanceServerSession {
      readonly #prepared = new Map<string, PreparedStatement>()
      readonly #portals = new Map<string, Portal>()

      onCommand(command: DbRawCommand, response: IResponseWriter): void {
        void this.#handle(command, response)
      }

      async #handle(command: DbRawCommand, response: IResponseWriter): Promise<void> {
        try {
          await this.#dispatch(command, response)
        } catch (error) {
          if (error instanceof SqlExecutionError || error instanceof ProtocolError) {
            response.error({ message: error.message, severity: "ERROR" })
            response.readyForQuery()
            return
          }
          if (error instanceof Error) {
            response.error({ message: error.message, severity: "ERROR" })
            response.readyForQuery()
            return
          }
          response.error({ message: String(error), severity: "ERROR" })
          response.readyForQuery()
        }
      }

      async #dispatch(command: DbRawCommand, response: IResponseWriter): Promise<void> {
        switch (command.command.type) {
          case CommandCode.init:
            this.#startup(response)
            return
          case CommandCode.query:
            await this.#runQuery(command.command.query, response)
            response.readyForQuery()
            return
          case CommandCode.parse:
            this.#prepared.set(command.command.queryName, { sql: command.command.query })
            response.parseComplete()
            return
          case CommandCode.bind: {
            const prepared = this.#prepared.get(command.command.statement)
            const sql = prepared?.sql ?? command.command.statement
            this.#portals.set(command.command.portal, {
              sql: bindParameters(sql, command.command.values),
            })
            response.bindComplete()
            return
          }
          case CommandCode.describe:
            response.noData()
            return
          case CommandCode.execute: {
            const portal = this.#portals.get(command.command.portal)
            if (portal === undefined) {
              throw new ProtocolError(`unknown portal ${command.command.portal}`)
            }
            await this.#runQuery(portal.sql, response)
            return
          }
          case CommandCode.sync:
          case CommandCode.flush:
            response.readyForQuery()
            return
          case CommandCode.close:
            response.closeComplete()
            return
          case CommandCode.end:
            response.socket.end()
            return
          case CommandCode.startup:
          case CommandCode.copyDone:
          case CommandCode.copyFail:
          case CommandCode.copyFromChunk:
            throw new ProtocolError(`unsupported command ${command.command.type}`)
          default:
            return assertNever(command.command)
        }
      }

      #startup(response: IResponseWriter): void {
        response.authenticationOk()
        response.parameterStatus("server_version", "16.0-gitdb")
        response.parameterStatus("server_encoding", "UTF8")
        response.parameterStatus("client_encoding", "UTF8")
        response.parameterStatus("DateStyle", "ISO, MDY")
        response.parameterStatus("integer_datetimes", "on")
        response.backendKeyData(process.pid, 1)
        response.readyForQuery()
      }

      async #runQuery(sql: string, response: IResponseWriter): Promise<void> {
        if (sql.trim().length === 0) {
          response.emptyQuery()
          return
        }
        const result = await options.engine.execute(sql)
        const fields = describeRows(result.rows)
        if (fields.length > 0) {
          response.rowDescription([...fields])
          for (const row of result.rows) {
            response.dataRow([...rowToWire(row, fields)])
          }
        }
        response.commandComplete(result.command || commandTag(sql, result.rowCount))
      }
    },
  )
  await listen(server, options.port, options.host)
  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : options.port
  return {
    close: () => close(server),
    host: options.host,
    port,
  }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, () => {
      server.off("error", reject)
      resolve()
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function assertNever(value: never): never {
  throw new ProtocolError(`unexpected command ${JSON.stringify(value)}`)
}

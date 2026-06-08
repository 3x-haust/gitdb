import { createStoreFromEnv, type StoreMode } from "../cli/store-factory.js"
import { createGitDbServer, type GitDbServer } from "../protocol/postgres-server.js"
import { GitDbEngine } from "../sql/engine.js"

export class GitDbRuntime {
  #server: GitDbServer | null = null
  #mode: StoreMode = "local"

  async start(): Promise<void> {
    const { env, mode, store } = createStoreFromEnv(process.env)
    const engine = await GitDbEngine.open({ store })
    this.#server = await createGitDbServer({ engine, host: env.GITDB_HOST, port: env.GITDB_PORT })
    this.#mode = mode
  }

  async stop(): Promise<void> {
    await this.#server?.close()
    this.#server = null
  }

  health(): {
    readonly facade: { readonly host: string; readonly port: number } | null
    readonly mode: StoreMode
    readonly status: "ready" | "starting"
  } {
    return {
      facade: this.#server === null ? null : { host: this.#server.host, port: this.#server.port },
      mode: this.#mode,
      status: this.#server === null ? "starting" : "ready",
    }
  }
}

export const gitDbRuntime = new GitDbRuntime()

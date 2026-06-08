import { Controller, Get } from "@nestjs/common"
import type { StoreMode } from "../cli/store-factory.js"
import { gitDbRuntime } from "./gitdb.runtime.js"

type HealthResponse = {
  readonly facade: {
    readonly host: string
    readonly port: number
  } | null
  readonly mode: StoreMode
  readonly status: "ready" | "starting"
}

@Controller()
export class GitDbController {
  @Get("/")
  root(): HealthResponse {
    return gitDbRuntime.health()
  }

  @Get("/health")
  health(): HealthResponse {
    return gitDbRuntime.health()
  }
}

import { Controller, Get } from "@nestjs/common"
import { gitDbRuntime } from "./gitdb.runtime.js"

type HealthResponse = {
  readonly facade: {
    readonly host: string
    readonly port: number
  } | null
  readonly mode: "github" | "local"
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

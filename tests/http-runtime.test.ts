import { describe, expect, it } from "vitest"
import { GitDbRuntime } from "../src/http/gitdb.runtime.js"

describe("GitDbRuntime", () => {
  it("reports starting health before the facade server is bootstrapped", () => {
    // Given: a freshly constructed deployable runtime.
    const runtime = new GitDbRuntime()

    // When: the control-plane health response is read before bootstrap.
    const health = runtime.health()

    // Then: deploy health checks get a stable response shape.
    expect(health).toEqual({ facade: null, mode: "local", status: "starting" })
  })
})

import { describe, expect, it } from "vitest"
import packageJson from "../package.json" with { type: "json" }

describe("npm publish metadata", () => {
  it("declares package root exports, types, and public publish config", () => {
    // Given: npm consumers install the built package by its root entrypoint.
    const metadata = packageJson

    // When: publish metadata is inspected before packing.
    const rootExport = metadata.exports["."]

    // Then: Node and TypeScript consumers get an explicit package surface.
    expect(metadata.main).toBe("./dist/src/index.js")
    expect(metadata.types).toBe("./dist/src/index.d.ts")
    expect(metadata.homepage).toBe("https://3x-haust.github.io/gitdb/")
    expect(metadata.bin).toEqual({ gitdb: "dist/src/cli/main.js" })
    expect(metadata.files).toEqual(["dist/src", "README.md", "docs"])
    expect(metadata.publishConfig).toEqual({ access: "public", provenance: true })
    expect(metadata.repository.url).toBe("git+https://github.com/3x-haust/gitdb.git")
    expect(rootExport).toEqual({
      import: "./dist/src/index.js",
      types: "./dist/src/index.d.ts",
    })
  })

  it("declares dry-run publish scripts that do not publish to npm", () => {
    // Given: release validation must be credential-safe.
    const scripts = packageJson.scripts

    // When: publish scripts are inspected.
    const pack = scripts["pack:dry-run"]
    const publish = scripts["publish:dry-run"]

    // Then: both commands validate package contents without publishing.
    expect(pack).toBe("corepack pnpm build && COREPACK_ENABLE_STRICT=0 npm pack --dry-run --json")
    expect(publish).toBe(
      "corepack pnpm build && COREPACK_ENABLE_STRICT=0 npm publish --dry-run --access public",
    )
  })
})

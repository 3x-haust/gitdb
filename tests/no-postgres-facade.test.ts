import { access, readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import packageJson from "../package.json" with { type: "json" }

const removedRuntimePackages = [
  "@nestjs/common",
  "@nestjs/core",
  "@nestjs/platform-express",
  "@prisma/adapter-pg",
  "@prisma/client",
  "@prisma/client-runtime-utils",
  "@types/express",
  "@types/pg",
  "express",
  "pg",
  "pg-server",
  "prisma",
  "reflect-metadata",
  "rxjs",
]

const removedLockfileTerms = [
  "@nestjs/platform-express",
  "@prisma/",
  "@types/express",
  "@types/pg",
  "express@5",
  "pg-protocol",
  "pg-server",
  "pg@8",
  "prisma@",
]

const removedPublicTerms = [
  "PostgreSQL",
  "Prisma",
  "createGitDbServer",
  "express-prisma",
  "facade",
  "pg-server",
  "postgres facade",
  "postgresql://",
  "start:facade",
]

const publicFiles = [
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/BENCHMARKS.md",
  "docs/README.ko.md",
  "site/app.js",
  "site/benchmark.json",
  "site/benchmark.md",
  "site/index.html",
  "site/assets/runtime-map.svg",
]

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

describe("PostgreSQL facade removal", () => {
  it("removes obsolete packages and scripts from package metadata", () => {
    const dependencies = packageJson.dependencies ?? {}
    const devDependencies = packageJson.devDependencies ?? {}
    const scripts = packageJson.scripts ?? {}

    for (const dependency of removedRuntimePackages) {
      expect(dependencies).not.toHaveProperty(dependency)
      expect(devDependencies).not.toHaveProperty(dependency)
    }
    for (const [name, command] of Object.entries(scripts)) {
      expect(name).not.toMatch(/facade|express-prisma/i)
      expect(command).not.toMatch(/facade|prisma|postgres|pg\b/i)
    }
    expect(scripts.example).toBe("corepack pnpm example:local-runtime")
    expect(scripts["example:local-runtime"]).toBe(
      "corepack pnpm build && node examples/local-runtime/index.mjs",
    )
  })

  it("removes the old wire-protocol service and generated ORM example files", async () => {
    const removedPaths = ["src/protocol", "src/http", "examples/express-prisma"]
    const requiredPaths = ["examples/local-runtime/index.mjs"]

    for (const path of removedPaths) {
      await expect(exists(path)).resolves.toBe(false)
    }
    for (const path of requiredPaths) {
      await expect(exists(path)).resolves.toBe(true)
    }
  })

  it("removes stale generated-example paths from tool config", async () => {
    for (const file of ["biome.json", ".gitignore"]) {
      const config = await readFile(file, "utf8")
      expect(config, `${file} still ignores the removed example`).not.toContain(
        "examples/express-prisma",
      )
    }
  })

  it("keeps public docs, site evidence, and lockfile free of facade positioning", async () => {
    for (const file of publicFiles) {
      const text = await readFile(file, "utf8")
      for (const term of removedPublicTerms) {
        expect(text, `${file} still contains ${term}`).not.toContain(term)
      }
    }

    const lockfile = await readFile("pnpm-lock.yaml", "utf8")
    for (const term of removedLockfileTerms) {
      expect(lockfile, `pnpm-lock.yaml still contains ${term}`).not.toContain(term)
    }
  })

  it("exports only the first-party runtime, storage engine, and repository API", async () => {
    const index = await readFile("src/index.ts", "utf8")
    expect(index).not.toContain("createGitDbServer")
    expect(index).not.toContain("./protocol/")
    expect(index).toContain("createGitDbDataSource")
    expect(index).toContain("GitDbEngine")
  })
})

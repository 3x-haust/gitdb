import { beforeEach, describe, expect, it, vi } from "vitest"
import { GitHubPlaintextStore } from "../src/github/github-plaintext-store.js"
import type { GitHubConfig } from "../src/github/types.js"

const octokit = vi.hoisted(() => ({
  createOrUpdateFileContents: vi.fn(),
  getContent: vi.fn(),
}))

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function MockOctokit() {
    return {
      repos: {
        createOrUpdateFileContents: octokit.createOrUpdateFileContents,
        getContent: octokit.getContent,
      },
    }
  }),
}))

const config = {
  branch: "main",
  owner: "3x-haust",
  prefix: "gitdb/v1",
  repo: "gitdb-example-db",
  token: "redacted-token",
} satisfies GitHubConfig

describe("GitHubPlaintextStore", () => {
  beforeEach(() => {
    octokit.createOrUpdateFileContents.mockReset()
    octokit.getContent.mockReset()
  })

  it("reads visible snapshot checkpoint metadata", async () => {
    // Given: GitHub stores a visible table snapshot with checkpoint metadata.
    octokit.getContent.mockImplementation(async ({ path }: { readonly path: string }) => {
      const content = githubContentFor(path)
      if (content === null) {
        throw new FakeGitHubStatusError(404)
      }
      return { data: content }
    })
    const store = new GitHubPlaintextStore(config)

    // When: the visible snapshot is read.
    const snapshot = await store.readVisibleSnapshot()

    // Then: the checkpoint sequence is preserved for manifest freshness checks.
    expect(snapshot).toEqual({
      sequence: 7,
      tables: [
        {
          columns: ["id", "name"],
          name: "people",
          rows: [{ id: "p1", name: "Lin" }],
        },
      ],
    })
  })

  it("writes visible snapshot checkpoint metadata", async () => {
    // Given: GitHub has no existing visible snapshot files.
    octokit.getContent.mockRejectedValue(new FakeGitHubStatusError(404))
    octokit.createOrUpdateFileContents.mockResolvedValue({ data: {} })
    const store = new GitHubPlaintextStore(config)

    // When: a checkpointed visible snapshot is written.
    await store.writeVisibleSnapshot({
      sequence: 9,
      tables: [
        {
          columns: ["id", "name"],
          name: "people",
          rows: [{ id: "p1", name: "Lin" }],
        },
      ],
    })

    // Then: GitHub receives snapshot metadata after table dashboard files.
    const writes = octokit.createOrUpdateFileContents.mock.calls.map(([request]) => request)
    expect(writes.map((request) => request.path)).toEqual([
      "gitdb/v1/people/schema.json",
      "gitdb/v1/people/data.json",
      "gitdb/v1/snapshot.json",
    ])
    expect(decodeContent(writes[2].content)).toEqual({ sequence: 9 })
  })
})

class FakeGitHubStatusError extends Error {
  constructor(readonly status: number) {
    super(`GitHub status ${status}`)
  }
}

function githubContentFor(path: string): unknown {
  switch (path) {
    case "gitdb/v1":
      return [
        { name: "log", type: "dir" },
        { name: "people", type: "dir" },
      ]
    case "gitdb/v1/snapshot.json":
      return encodedFile({ sequence: 7 }, "snapshot-sha")
    case "gitdb/v1/people/schema.json":
      return encodedFile({ columns: ["id", "name"], name: "people" }, "schema-sha")
    case "gitdb/v1/people/data.json":
      return encodedFile([{ id: "p1", name: "Lin" }], "data-sha")
    default:
      return null
  }
}

function encodedFile(
  value: unknown,
  sha: string,
): { readonly content: string; readonly sha: string } {
  return {
    content: Buffer.from(JSON.stringify(value), "utf8").toString("base64"),
    sha,
  }
}

function decodeContent(content: unknown): unknown {
  if (typeof content !== "string") {
    throw new TypeError("expected GitHub content to be a base64 string")
  }
  return JSON.parse(Buffer.from(content, "base64").toString("utf8")) as unknown
}

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { handleMarkdown } from "../server/markdown.mjs"

let root
let server
let baseUrl

const request = async (path, init) => {
  const response = await fetch(`${baseUrl}${path}`, init)
  const payload = await response.json()
  return { response, payload }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "slate-markdown-"))
  process.env.MARKDOWN_ROOT = root
  server = createServer(async (incoming, outgoing) => {
    if (!(await handleMarkdown(incoming, outgoing))) outgoing.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("Missing test port")
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  )
  await rm(root, { recursive: true, force: true })
})

describe("Markdown file API", () => {
  it("creates the sample only when absent and lists allowlisted Markdown files", async () => {
    const first = await request("/api/markdown")
    expect(first.response.status).toBe(200)
    expect(first.payload.files).toEqual(["README.md"])

    await writeFile(join(root, "notes.md"), "# Existing\n", "utf8")
    await writeFile(join(root, "ignore.txt"), "not markdown", "utf8")
    const second = await request("/api/markdown")
    expect(second.payload.files).toEqual(["notes.md", "README.md"])
  })

  it("lists nested Markdown files as a tree and opens their relative paths", async () => {
    await mkdir(join(root, "프로젝트", "회의"), { recursive: true })
    await writeFile(join(root, "프로젝트", "회의", "결정.md"), "# 결정\n", "utf8")

    const listed = await request("/api/markdown")
    const loaded = await request(
      `/api/markdown/file?name=${encodeURIComponent("프로젝트/회의/결정.md")}`,
    )

    expect(listed.payload.files).toContain("프로젝트/회의/결정.md")
    expect(listed.payload.tree[0]).toMatchObject({ kind: "file", path: "README.md" })
    expect(JSON.stringify(listed.payload.tree)).toContain("프로젝트/회의/결정.md")
    expect(loaded.payload.content).toBe("# 결정\n")
  })

  it("rejects symlinked Markdown files and traversal paths", async () => {
    const outside = join(root, "..", `outside-${crypto.randomUUID()}.md`)
    await writeFile(outside, "secret\n", "utf8")
    await symlink(outside, join(root, "linked.md"))

    const listed = await request("/api/markdown")
    const linked = await request("/api/markdown/file?name=linked.md")
    const escaped = await request(
      `/api/markdown/file?name=${encodeURIComponent("nested/../../secret.md")}`,
    )

    expect(listed.payload.files).not.toContain("linked.md")
    expect(linked.response.status).toBe(404)
    expect(escaped.response.status).toBe(400)
    await rm(outside, { force: true })
  })

  it("roundtrips exact source, maps blocks, and keeps IDs for unchanged spans", async () => {
    const source = "# 제목\n\n문단  *spacing*\n\n:::unknown\nraw\n::: \n\n```js\nconst x = 1\n```\n"
    await writeFile(join(root, "roundtrip.md"), source, "utf8")
    await request("/api/markdown")

    const loaded = await request("/api/markdown/file?name=roundtrip.md")
    expect(loaded.response.status).toBe(200)
    expect(loaded.payload.content).toBe(source)
    expect(loaded.payload.mappings.map(({ type }) => type)).toContain("heading")
    expect(loaded.payload.mappings.map(({ type }) => type)).toContain("code")
    expect(
      loaded.payload.mappings.every(
        ({ startLine, endLine }) => startLine >= 1 && endLine >= startLine,
      ),
    ).toBe(true)

    const heading = loaded.payload.mappings.find(({ type }) => type === "heading")
    const changed = `${source}\n새 문단\n`
    const saved = await request("/api/markdown/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "roundtrip.md",
        content: changed,
        expectedRevision: loaded.payload.revision,
      }),
    })
    expect(saved.response.status).toBe(200)
    expect(await readFile(join(root, "roundtrip.md"), "utf8")).toBe(changed)
    expect(saved.payload.mappings.find(({ type }) => type === "heading")?.id).toBe(heading.id)
  })

  it("maps an unsaved source preview without changing the disk file", async () => {
    const diskSource = "# Disk heading\n\nDisk paragraph\n"
    const draftSource = "Preface\n\n# Draft heading\n\nDraft paragraph\n"
    await writeFile(join(root, "preview.md"), diskSource, "utf8")
    await request("/api/markdown")

    const preview = await request("/api/markdown/map", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "preview.md", content: draftSource }),
    })
    expect(preview.response.status).toBe(200)
    expect(preview.payload.mappings.find(({ type }) => type === "heading")?.startLine).toBe(3)
    expect(await readFile(join(root, "preview.md"), "utf8")).toBe(diskSource)
  })

  it("rejects stale writes without replacing the disk version", async () => {
    await writeFile(join(root, "conflict.md"), "disk one\n", "utf8")
    await request("/api/markdown")
    const loaded = await request("/api/markdown/file?name=conflict.md")
    await writeFile(join(root, "conflict.md"), "disk two\n", "utf8")

    const conflict = await request("/api/markdown/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "conflict.md",
        content: "my draft\n",
        expectedRevision: loaded.payload.revision,
      }),
    })
    expect(conflict.response.status).toBe(409)
    expect(conflict.payload.content).toBe("disk two\n")
    expect(await readFile(join(root, "conflict.md"), "utf8")).toBe("disk two\n")
  })

  it("allows only one simultaneous save for the same expected revision", async () => {
    await writeFile(join(root, "race.md"), "baseline\n", "utf8")
    await request("/api/markdown")
    const loaded = await request("/api/markdown/file?name=race.md")
    const save = (content) =>
      request("/api/markdown/file", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "race.md",
          content,
          expectedRevision: loaded.payload.revision,
        }),
      })

    const outcomes = await Promise.all([save("first\n"), save("second\n")])
    expect(outcomes.map(({ response }) => response.status).sort()).toEqual([200, 409])
    const winner = outcomes.find(({ response }) => response.status === 200)
    expect(await readFile(join(root, "race.md"), "utf8")).toBe(winner.payload.content)
  })

  it("handles simultaneous first list requests without a sample creation race", async () => {
    const outcomes = await Promise.all([request("/api/markdown"), request("/api/markdown")])
    expect(outcomes.map(({ response }) => response.status)).toEqual([200, 200])
    expect(
      outcomes.map(({ payload }) => payload.files).every((files) => files.includes("README.md")),
    ).toBe(true)
  })

  it("rejects names outside the list and oversized request bodies", async () => {
    await request("/api/markdown")
    const escaped = await request("/api/markdown/file?name=../secret.md")
    expect(escaped.response.status).toBe(400)

    const oversized = await request("/api/markdown/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "README.md",
        content: "x".repeat(2_000_001),
        expectedRevision: "irrelevant",
      }),
    })
    expect(oversized.response.status).toBe(413)
  })

  it("returns false without writing a response for unrelated routes", async () => {
    const response = await fetch(`${baseUrl}/unrelated`)
    expect(response.status).toBe(404)
  })
})

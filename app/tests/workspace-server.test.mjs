import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createApplicationServer } from "../server/application.mjs"

let server
let root

const open = async () => {
  server = createApplicationServer({
    runtimeRoot: root,
    sessionSecret: "workspace-integration-secret-value",
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("Missing address")
  return `http://127.0.0.1:${address.port}`
}

const session = async (base, identity) => {
  const response = await fetch(`${base}/api/demo/session?identity=${identity}`, { method: "POST" })
  return response.headers.getSetCookie()[0]?.split(";", 1)[0]
}

afterEach(async () => {
  server?.closeAllConnections()
  if (server?.listening) await new Promise((resolve) => server.close(resolve))
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

describe("structured workspace API", () => {
  it("persists separate page, database, and synced entities across a restart", async () => {
    root = await mkdtemp(join(tmpdir(), "structured-workspace-"))
    const firstBase = await open()
    const author = await session(firstBase, "author")
    const initial = await fetch(`${firstBase}/api/workspace`, { headers: { cookie: author } }).then(
      (response) => response.json(),
    )
    const source = initial.sources[0]
    const changed = await fetch(`${firstBase}/api/workspace/sources/${source.content.id}`, {
      method: "PUT",
      headers: { cookie: author, "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: source.revision,
        content: {
          ...source.content,
          version: source.content.version + 1,
          blocks: [{ id: "shared-p", type: "paragraph", text: "Updated once" }],
        },
      }),
    })
    expect(changed.status).toBe(200)
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))

    const secondBase = await open()
    const reopenedAuthor = await session(secondBase, "author")
    const reopened = await fetch(`${secondBase}/api/workspace`, {
      headers: { cookie: reopenedAuthor },
    }).then((response) => response.json())

    expect(reopened.sources[0].content.blocks[0].text).toBe("Updated once")
    expect(reopened.documents.map((record) => record.revision)).toEqual(
      initial.documents.map((record) => record.revision),
    )
    expect(reopened.documents[0].content.blocks).toBeDefined()
    expect(reopened.databases[0].content.rows).toBeDefined()
  })

  it("rejects stale writes and viewer mutations", async () => {
    root = await mkdtemp(join(tmpdir(), "structured-workspace-"))
    const base = await open()
    const author = await session(base, "author")
    const viewer = await session(base, "viewer")
    const initial = await fetch(`${base}/api/workspace`, { headers: { cookie: author } }).then(
      (response) => response.json(),
    )
    const database = initial.databases[0]
    const body = JSON.stringify({ expectedRevision: database.revision, content: database.content })
    const first = await fetch(`${base}/api/workspace/databases/${database.content.id}`, {
      method: "PUT",
      headers: { cookie: author, "content-type": "application/json" },
      body,
    })
    const stale = await fetch(`${base}/api/workspace/databases/${database.content.id}`, {
      method: "PUT",
      headers: { cookie: author, "content-type": "application/json" },
      body,
    })
    const forbidden = await fetch(`${base}/api/workspace/databases/${database.content.id}`, {
      method: "PUT",
      headers: { cookie: viewer, "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: database.revision + 1, content: database.content }),
    })

    expect(first.status).toBe(200)
    expect(stale.status).toBe(409)
    expect(forbidden.status).toBe(403)
  })
})

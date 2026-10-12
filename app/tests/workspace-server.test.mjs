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

const workspace = (base, cookie) =>
  fetch(`${base}/api/workspace`, { headers: { cookie } }).then((response) => response.json())

const putEntity = (base, cookie, kind, id, body) =>
  fetch(`${base}/api/workspace/${kind}/${id}`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  })

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
    const changed = await fetch(`${firstBase}/api/workspace/sources/${source.documentId}`, {
      method: "PUT",
      headers: { cookie: author, "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: source.revision,
        content: {
          ...source.content,
          version: source.content.version + 1,
          section: {
            ...source.content.section,
            children: [{ id: "shared-p", type: "paragraph", text: "Updated once" }],
          },
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

    expect(reopened.sources[0].content.section.children[0].text).toBe("Updated once")
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

  it("enumerates a newly persisted page document after restart", async () => {
    root = await mkdtemp(join(tmpdir(), "structured-workspace-"))
    const firstBase = await open()
    const author = await session(firstBase, "author")
    const initial = await workspace(firstBase, author)
    const created = await fetch(`${firstBase}/api/workspace/pages`, {
      method: "POST",
      headers: { cookie: author, "content-type": "application/json" },
      body: JSON.stringify({
        expectedTreeRevision: initial.tree.revision,
        page: {
          id: "retrospective",
          parentId: "project",
          title: "Retrospective",
          icon: "file",
        },
      }),
    })
    expect(created.status).toBe(201)
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))

    const secondBase = await open()
    const reopenedAuthor = await session(secondBase, "author")
    const reopened = await workspace(secondBase, reopenedAuthor)

    expect(reopened.tree.content.pages).toContainEqual({
      id: "retrospective",
      parentId: "project",
      title: "Retrospective",
      icon: "file",
      archived: false,
    })
    expect(reopened.documents.some((record) => record.documentId === "retrospective")).toBe(true)
  })

  it("rejects route and content identity mismatches", async () => {
    root = await mkdtemp(join(tmpdir(), "structured-workspace-"))
    const base = await open()
    const author = await session(base, "author")
    const initial = await workspace(base, author)
    const page = initial.documents[0]
    const database = initial.databases[0]
    const source = initial.sources[0]

    const responses = await Promise.all([
      putEntity(base, author, "pages", page.documentId, {
        expectedRevision: page.revision,
        content: { ...page.content, pageId: "different-page" },
      }),
      putEntity(base, author, "databases", database.documentId, {
        expectedRevision: database.revision,
        content: { ...database.content, id: "different-database" },
      }),
      putEntity(base, author, "sources", source.documentId, {
        expectedRevision: source.revision,
        content: { ...source.content, id: "different-source" },
      }),
      putEntity(base, author, "trees", initial.tree.documentId, {
        expectedRevision: initial.tree.revision,
        content: { ...initial.tree.content, id: "different-tree" },
      }),
    ])

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400])
  })

  it("creates a new canonical synced source without an existing revision", async () => {
    root = await mkdtemp(join(tmpdir(), "structured-workspace-"))
    const base = await open()
    const author = await session(base, "author")
    const source = {
      id: "created-source",
      version: 1,
      section: {
        id: "created-source-root",
        type: "section",
        children: [{ id: "created-source-body", type: "paragraph", text: "Canonical" }],
      },
    }

    const created = await putEntity(base, author, "sources", source.id, { content: source })
    const reopened = await workspace(base, author)

    expect(created.status).toBe(201)
    expect(reopened.sources.some((record) => record.content.id === source.id)).toBe(true)
  })

  it("rejects malformed typed database values and dangling references", async () => {
    root = await mkdtemp(join(tmpdir(), "structured-workspace-"))
    const base = await open()
    const author = await session(base, "author")
    const initial = await workspace(base, author)
    const database = initial.databases[0]
    const page = initial.documents[0]

    const malformedDatabase = await putEntity(base, author, "databases", database.documentId, {
      expectedRevision: database.revision,
      content: {
        ...database.content,
        rows: database.content.rows.map((row, index) =>
          index === 0 ? { ...row, values: { ...row.values, done: "yes" } } : row,
        ),
      },
    })
    const danglingPage = await putEntity(base, author, "pages", page.documentId, {
      expectedRevision: page.revision,
      content: {
        ...page.content,
        blocks: [
          ...page.content.blocks,
          { id: "missing-page-link", type: "page_ref", pageId: "missing-page" },
        ],
      },
    })

    expect(malformedDatabase.status).toBe(400)
    expect(danglingPage.status).toBe(400)
  })
})

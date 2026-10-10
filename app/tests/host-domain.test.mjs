import { once } from "node:events"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import { afterEach, describe, expect, it } from "vitest"
import WebSocket from "ws"
import * as syncProtocol from "y-protocols/sync"
import * as Y from "yjs"
import { createApplicationServer } from "../server/application.mjs"

const resources = []

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    if (resource.kind === "server") {
      resource.value.closeAllConnections()
      await new Promise((resolve) => resource.value.close(resolve))
    } else if (resource.kind === "socket") {
      resource.value.close()
    } else {
      await rm(resource.value, { recursive: true, force: true })
    }
  }
})

const open = async (runtimeRoot) => {
  const server = createApplicationServer({
    runtimeRoot,
    sessionSecret: "integration-secret-with-enough-entropy",
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  resources.unshift({ kind: "server", value: server })
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("Missing server address")
  return `http://127.0.0.1:${address.port}`
}

const session = async (base, identity) => {
  const response = await fetch(`${base}/api/demo/session?identity=${identity}`, { method: "POST" })
  const cookie = response.headers.getSetCookie()[0]
  if (cookie === undefined) throw new TypeError("Missing demo session cookie")
  return cookie.split(";", 1)[0]
}

const connectRoom = async (base, cookie, initialUpdate) => {
  const socket = new WebSocket(`${base.replace("http", "ws")}/collaboration?room=team-minutes`, {
    headers: { cookie },
  })
  await once(socket, "open")
  socket.send(
    JSON.stringify({
      type: "hello",
      schemaVersion: "block-editor/v0.3",
      initialUpdate: Buffer.from(initialUpdate).toString("base64"),
    }),
  )
  const [ready] = await once(socket, "message")
  expect(JSON.parse(ready.toString())).toMatchObject({ type: "ready" })
  return socket
}

const syncUpdate = (update) => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, 0)
  syncProtocol.writeUpdate(encoder, update)
  return encoding.toUint8Array(encoder)
}

const connectBoundRoom = async (base, cookie, doc) => {
  const socket = new WebSocket(`${base.replace("http", "ws")}/collaboration?room=team-minutes`, {
    headers: { cookie },
  })
  const origin = {}
  const ready = new Promise((resolve) =>
    socket.on("message", (data, isBinary) => {
      if (!isBinary) {
        resolve(JSON.parse(data.toString()))
        return
      }
      const decoder = decoding.createDecoder(new Uint8Array(data))
      if (decoding.readVarUint(decoder) !== 0) return
      const reply = encoding.createEncoder()
      encoding.writeVarUint(reply, 0)
      syncProtocol.readSyncMessage(decoder, reply, doc, origin)
      const bytes = encoding.toUint8Array(reply)
      if (bytes.length > 1) socket.send(bytes)
    }),
  )
  await once(socket, "open")
  socket.send(
    JSON.stringify({
      type: "hello",
      schemaVersion: "block-editor/v0.3",
      initialUpdate: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"),
    }),
  )
  await ready
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, 0)
  syncProtocol.writeSyncStep1(encoder, doc)
  socket.send(encoding.toUint8Array(encoder))
  return socket
}

describe("durable host domain", () => {
  it("persists a document and workflow across application restarts", async () => {
    const root = await mkdtemp(join(tmpdir(), "block-editor-host-"))
    resources.push({ kind: "root", value: root })
    const firstBase = await open(root)
    const author = await session(firstBase, "author")
    const created = await fetch(`${firstBase}/api/documents/team-minutes`, {
      method: "PUT",
      headers: { cookie: author, "content-type": "application/json" },
      body: JSON.stringify({
        content: { title: "Weekly notes", unknown: { preserved: true } },
        metadata: { owner: "author" },
      }),
    })
    expect(created.status).toBe(201)
    const submitted = await fetch(`${firstBase}/api/workflows/team-minutes/submit`, {
      method: "POST",
      headers: { cookie: author, "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1 }),
    })
    expect(submitted.status).toBe(200)
    const firstServer = resources.shift().value
    firstServer.closeAllConnections()
    await new Promise((resolve) => firstServer.close(resolve))

    const secondBase = await open(root)
    const viewer = await session(secondBase, "viewer")
    const reopened = await fetch(`${secondBase}/api/documents/team-minutes`, {
      headers: { cookie: viewer },
    })
    expect(await reopened.json()).toMatchObject({
      revision: 1,
      content: { title: "Weekly notes", unknown: { preserved: true } },
      metadata: { owner: "author" },
    })
  })

  it("denies viewer writes and approvals at the HTTP boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "block-editor-host-"))
    resources.push({ kind: "root", value: root })
    const base = await open(root)
    const author = await session(base, "author")
    const viewer = await session(base, "viewer")
    await fetch(`${base}/api/documents/team-minutes`, {
      method: "PUT",
      headers: { cookie: author, "content-type": "application/json" },
      body: JSON.stringify({ content: { title: "Protected" } }),
    })

    const write = await fetch(`${base}/api/documents/team-minutes`, {
      method: "PUT",
      headers: { cookie: viewer, "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1, content: { title: "Forbidden" } }),
    })
    const approve = await fetch(`${base}/api/workflows/team-minutes/approve`, {
      method: "POST",
      headers: { cookie: viewer, "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1 }),
    })

    expect(write.status).toBe(403)
    expect(approve.status).toBe(403)
  })

  it("persists collaboration updates and rejects raw viewer writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "block-editor-host-"))
    resources.push({ kind: "root", value: root })
    const base = await open(root)
    const author = await session(base, "author")
    const doc = new Y.Doc()
    doc.getText("body").insert(0, "restart-safe")
    const authorSocket = await connectRoom(base, author, Y.encodeStateAsUpdate(doc))
    resources.unshift({ kind: "socket", value: authorSocket })
    authorSocket.send(syncUpdate(Y.encodeStateAsUpdate(doc)))
    const snapshotPath = join(root, "collaboration", "team-minutes.yjs")
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        if ((await readFile(snapshotPath)).byteLength > 0) break
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect((await readFile(snapshotPath)).byteLength).toBeGreaterThan(0)

    authorSocket.close()
    const serverIndex = resources.findIndex((resource) => resource.kind === "server")
    const firstServer = resources.splice(serverIndex, 1)[0].value
    firstServer.closeAllConnections()
    await new Promise((resolve) => firstServer.close(resolve))
    const reopenedBase = await open(root)
    const reopenedAuthor = await session(reopenedBase, "author")
    const reopenedDoc = new Y.Doc()
    const reopenedSocket = await connectBoundRoom(reopenedBase, reopenedAuthor, reopenedDoc)
    resources.unshift({ kind: "socket", value: reopenedSocket })
    for (
      let attempt = 0;
      attempt < 100 && reopenedDoc.getText("body").toString() !== "restart-safe";
      attempt += 1
    )
      await new Promise((resolve) => setTimeout(resolve, 10))
    expect(reopenedDoc.getText("body").toString()).toBe("restart-safe")

    const reopenedViewer = await session(reopenedBase, "viewer")
    const viewerSocket = await connectRoom(reopenedBase, reopenedViewer, new Uint8Array())
    resources.unshift({ kind: "socket", value: viewerSocket })
    const closed = once(viewerSocket, "close")
    viewerSocket.send(syncUpdate(Y.encodeStateAsUpdate(doc)))
    const [code] = await closed

    expect(code).toBe(1008)
  })
})

import { createServer } from "node:http"
import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import { afterEach, describe, expect, it } from "vitest"
import WebSocket from "ws"
import * as awarenessProtocol from "y-protocols/awareness"
import * as syncProtocol from "y-protocols/sync"
import * as Y from "yjs"
import { attachCollaboration } from "../server/collaboration.mjs"

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const sockets = []
const servers = []

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close()
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  )
})

const openServer = async () => {
  const server = createServer()
  attachCollaboration(server)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  servers.push(server)
  const address = server.address()
  if (typeof address !== "object" || address === null) throw new TypeError("Missing server address")
  return `ws://127.0.0.1:${address.port}/collaboration?room=test-room`
}

const connect = async (url, schemaVersion, initialUpdate) => {
  const socket = new WebSocket(url)
  sockets.push(socket)
  await new Promise((resolve, reject) => {
    socket.once("open", resolve)
    socket.once("error", reject)
  })
  socket.send(
    JSON.stringify({
      type: "hello",
      schemaVersion,
      initialUpdate: Buffer.from(initialUpdate).toString("base64"),
    }),
  )
  return socket
}

const waitForJson = (socket) =>
  new Promise((resolve) => {
    const receive = (data, isBinary) => {
      if (isBinary) return
      socket.off("message", receive)
      resolve(JSON.parse(data.toString()))
    }
    socket.on("message", receive)
  })

const waitForClose = (socket) =>
  new Promise((resolve) => socket.once("close", (code) => resolve(code)))

const bind = (socket, doc) => {
  const origin = {}
  socket.on("message", (data, isBinary) => {
    if (!isBinary) return
    const decoder = decoding.createDecoder(new Uint8Array(data))
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return
    const reply = encoding.createEncoder()
    encoding.writeVarUint(reply, MESSAGE_SYNC)
    syncProtocol.readSyncMessage(decoder, reply, doc, origin)
    const bytes = encoding.toUint8Array(reply)
    if (bytes.length > 1) socket.send(bytes)
  })
  doc.on("update", (update, updateOrigin) => {
    if (updateOrigin === origin) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeUpdate(encoder, update)
    socket.send(encoding.toUint8Array(encoder))
  })
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeSyncStep1(encoder, doc)
  socket.send(encoding.toUint8Array(encoder))
}

const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("Timed out waiting for collaboration state")
}

const sendAwareness = (socket, awareness) => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]),
  )
  socket.send(encoding.toUint8Array(encoder))
}

describe("collaboration websocket", () => {
  it("converges edits and restores state after reconnect", async () => {
    const url = await openServer()
    const seed = new Y.Doc()
    seed.getText("body").insert(0, "seed")
    const firstDoc = new Y.Doc()
    const secondDoc = new Y.Doc()
    const first = await connect(url, "block-editor/v0.3", Y.encodeStateAsUpdate(seed))
    expect(await waitForJson(first)).toMatchObject({ type: "ready" })
    bind(first, firstDoc)
    await waitFor(() => firstDoc.getText("body").toString() === "seed")
    const second = await connect(url, "block-editor/v0.3", Y.encodeStateAsUpdate(seed))
    expect(await waitForJson(second)).toMatchObject({ type: "ready" })
    bind(second, secondDoc)
    await waitFor(() => secondDoc.getText("body").toString() === "seed")

    firstDoc.getText("body").insert(4, "-one")
    secondDoc.getText("body").insert(0, "two-")
    await waitFor(
      () => firstDoc.getText("body").toString() === secondDoc.getText("body").toString(),
    )
    const converged = firstDoc.getText("body").toString()
    second.close()

    const reconnectedDoc = new Y.Doc()
    const reconnected = await connect(url, "block-editor/v0.3", Y.encodeStateAsUpdate(seed))
    await waitForJson(reconnected)
    bind(reconnected, reconnectedDoc)
    await waitFor(() => reconnectedDoc.getText("body").toString() === converged)
    expect(reconnectedDoc.getText("body").toString()).toBe(converged)
  })

  it("rejects an incompatible schema before accepting updates", async () => {
    const url = await openServer()
    const socket = await connect(url, "block-editor/v9", new Uint8Array())
    expect(await waitForJson(socket)).toEqual({
      type: "rejected",
      reason: "schema-incompatible",
      expectedSchemaVersion: "block-editor/v0.3",
    })
  })

  it("broadcasts presence independently from document updates", async () => {
    const url = await openServer()
    const first = await connect(url, "block-editor/v0.3", new Uint8Array())
    await waitForJson(first)
    const second = await connect(url, "block-editor/v0.3", new Uint8Array())
    await waitForJson(second)
    const firstAwareness = new awarenessProtocol.Awareness(new Y.Doc())
    const secondAwareness = new awarenessProtocol.Awareness(new Y.Doc())
    firstAwareness.setLocalStateField("user", { name: "first", color: "#123456" })
    second.on("message", (data, isBinary) => {
      if (!isBinary) return
      const decoder = decoding.createDecoder(new Uint8Array(data))
      if (decoding.readVarUint(decoder) !== MESSAGE_AWARENESS) return
      awarenessProtocol.applyAwarenessUpdate(
        secondAwareness,
        decoding.readVarUint8Array(decoder),
        "server",
      )
    })

    sendAwareness(first, firstAwareness)
    await waitFor(() =>
      [...secondAwareness.getStates().values()].some((state) => state.user?.name === "first"),
    )
    expect([...secondAwareness.getStates().values()]).toContainEqual({
      user: { name: "first", color: "#123456" },
    })
    firstAwareness.destroy()
    secondAwareness.destroy()
  })

  it("isolates malformed peers without taking down the room", async () => {
    const url = await openServer()
    const malformed = await connect(url, "block-editor/v0.3", new Uint8Array())
    await waitForJson(malformed)
    const closed = waitForClose(malformed)
    malformed.send(Uint8Array.of(MESSAGE_SYNC))
    await expect(closed).resolves.toBe(1003)

    const healthy = await connect(url, "block-editor/v0.3", new Uint8Array())
    await expect(waitForJson(healthy)).resolves.toMatchObject({ type: "ready" })
  })

  it("rejects a malformed initial Yjs update and continues accepting clients", async () => {
    const url = await openServer()
    const malformed = await connect(url, "block-editor/v0.3", Uint8Array.of(1, 2, 3))
    await expect(waitForClose(malformed)).resolves.toBe(1008)

    const healthy = await connect(url, "block-editor/v0.3", new Uint8Array())
    await expect(waitForJson(healthy)).resolves.toMatchObject({ type: "ready" })
  })
})

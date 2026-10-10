import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import { WebSocket, WebSocketServer } from "ws"
import * as awarenessProtocol from "y-protocols/awareness"
import * as syncProtocol from "y-protocols/sync"
import * as Y from "yjs"

const SCHEMA_VERSION = "block-editor/v0.3"
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const ROOM_TTL_MS = 5 * 60 * 1000
const HANDSHAKE_TIMEOUT_MS = 10 * 1000
const MAX_ROOMS = 100

const send = (socket, payload) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(payload)
}

const binaryMessage = (type, writePayload) => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, type)
  writePayload(encoder)
  return encoding.toUint8Array(encoder)
}

const createRoom = (initialUpdate) => {
  const doc = new Y.Doc()
  if (initialUpdate.byteLength > 0) Y.applyUpdate(doc, initialUpdate)
  const awareness = new awarenessProtocol.Awareness(doc)
  awareness.setLocalState(null)
  return { doc, awareness, connections: new Map(), cleanupTimer: null }
}

const closeMalformed = (socket) => socket.close(1003, "Malformed collaboration message")

const broadcast = (room, payload, origin) => {
  for (const socket of room.connections.keys()) {
    if (socket !== origin) send(socket, payload)
  }
}

const wireRoom = (room) => {
  room.doc.on("update", (update, origin) => {
    const payload = binaryMessage(MESSAGE_SYNC, (encoder) => syncProtocol.writeUpdate(encoder, update))
    broadcast(room, payload, origin)
  })
  room.awareness.on("update", ({ added, updated, removed }, origin) => {
    const controlled = room.connections.get(origin)
    if (controlled !== undefined) {
      for (const clientId of [...added, ...updated]) controlled.add(clientId)
      for (const clientId of removed) controlled.delete(clientId)
    }
    const changed = [...added, ...updated, ...removed]
    const payload = binaryMessage(MESSAGE_AWARENESS, (encoder) =>
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, changed),
      ),
    )
    broadcast(room, payload, origin)
  })
}

const reject = (socket) => {
  send(
    socket,
    JSON.stringify({
      type: "rejected",
      reason: "schema-incompatible",
      expectedSchemaVersion: SCHEMA_VERSION,
    }),
  )
  socket.close(1008, "Schema incompatible")
}

export const attachCollaboration = (server) => {
  const rooms = new Map()
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES })

  const destroyRoom = (roomName, room) => {
    if (room.cleanupTimer !== null) clearTimeout(room.cleanupTimer)
    room.awareness.destroy()
    room.doc.destroy()
    rooms.delete(roomName)
  }

  server.once("close", () => {
    for (const [roomName, room] of rooms) destroyRoom(roomName, room)
  })

  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost")
    if (requestUrl.pathname !== "/collaboration") return
    const roomName = requestUrl.searchParams.get("room")
    if (roomName === null || !/^[a-zA-Z0-9_-]{1,80}$/.test(roomName)) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n")
      socket.destroy()
      return
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request, roomName)
    })
  })

  webSocketServer.on("connection", (socket, _request, roomName) => {
    let room = null
    const handshakeTimer = setTimeout(
      () => socket.close(1008, "Handshake timed out"),
      HANDSHAKE_TIMEOUT_MS,
    )
    handshakeTimer.unref()
    socket.on("error", () => socket.close())
    socket.once("message", (raw, isBinary) => {
      clearTimeout(handshakeTimer)
      if (isBinary || raw.byteLength > MAX_MESSAGE_BYTES) {
        socket.close(1009, "Invalid handshake")
        return
      }
      let hello
      if (!rooms.has(roomName) && rooms.size >= MAX_ROOMS) {
        socket.close(1013, "Room capacity reached")
        return
      }
      try {
        hello = JSON.parse(raw.toString())
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        socket.close(1008, "Invalid handshake")
        return
      }
      if (
        typeof hello !== "object" ||
        hello === null ||
        hello.type !== "hello" ||
        hello.schemaVersion !== SCHEMA_VERSION ||
        typeof hello.initialUpdate !== "string"
      ) {
        reject(socket)
        return
      }
      if (
        hello.initialUpdate.length > Math.ceil(MAX_MESSAGE_BYTES / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          hello.initialUpdate,
        )
      ) {
        socket.close(1008, "Invalid initial document")
        return
      }
      const initialUpdate = Uint8Array.from(Buffer.from(hello.initialUpdate, "base64"))
      if (initialUpdate.byteLength > MAX_MESSAGE_BYTES) {
        socket.close(1009, "Initial document is too large")
        return
      }
      try {
        room = rooms.get(roomName) ?? createRoom(initialUpdate)
      } catch {
        socket.close(1008, "Invalid initial document")
        return
      }
      if (!rooms.has(roomName)) {
        rooms.set(roomName, room)
        wireRoom(room)
      }
      if (room.cleanupTimer !== null) {
        clearTimeout(room.cleanupTimer)
        room.cleanupTimer = null
      }
      room.connections.set(socket, new Set())
      send(socket, JSON.stringify({ type: "ready", schemaVersion: SCHEMA_VERSION }))
      send(
        socket,
        binaryMessage(MESSAGE_SYNC, (encoder) => syncProtocol.writeSyncStep1(encoder, room.doc)),
      )
      const presentClients = [...room.awareness.getStates().keys()]
      if (presentClients.length > 0) {
        send(
          socket,
          binaryMessage(MESSAGE_AWARENESS, (encoder) =>
            encoding.writeVarUint8Array(
              encoder,
              awarenessProtocol.encodeAwarenessUpdate(room.awareness, presentClients),
            ),
          ),
        )
      }

      socket.on("message", (message, binary) => {
        if (!binary || message.byteLength > MAX_MESSAGE_BYTES || room === null) {
          closeMalformed(socket)
          return
        }
        try {
          const decoder = decoding.createDecoder(new Uint8Array(message))
          const messageType = decoding.readVarUint(decoder)
          if (messageType === MESSAGE_SYNC) {
            const reply = encoding.createEncoder()
            encoding.writeVarUint(reply, MESSAGE_SYNC)
            syncProtocol.readSyncMessage(decoder, reply, room.doc, socket)
            const response = encoding.toUint8Array(reply)
            if (response.byteLength > 1) send(socket, response)
            return
          }
          if (messageType === MESSAGE_AWARENESS) {
            awarenessProtocol.applyAwarenessUpdate(
              room.awareness,
              decoding.readVarUint8Array(decoder),
              socket,
            )
            return
          }
          closeMalformed(socket)
        } catch {
          closeMalformed(socket)
        }
      })
    })

    socket.on("close", () => {
      clearTimeout(handshakeTimer)
      if (room === null) return
      const controlled = room.connections.get(socket)
      room.connections.delete(socket)
      if (controlled !== undefined)
        awarenessProtocol.removeAwarenessStates(room.awareness, [...controlled], socket)
      if (room.connections.size === 0) {
        room.cleanupTimer = setTimeout(() => destroyRoom(roomName, room), ROOM_TTL_MS)
        room.cleanupTimer.unref()
      }
    })
  })

  return webSocketServer
}

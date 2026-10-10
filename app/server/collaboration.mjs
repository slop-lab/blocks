import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import { WebSocketServer } from "ws"
import * as awarenessProtocol from "y-protocols/awareness"
import * as syncProtocol from "y-protocols/sync"
import * as Y from "yjs"
import {
  createCollaborationRoom,
  encodeCollaborationMessage,
  sendCollaborationMessage,
  wireCollaborationRoom,
} from "./collaboration-room.mjs"

const SCHEMA_VERSION = "block-editor/v0.3"
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const ROOM_TTL_MS = 5 * 60 * 1000
const HANDSHAKE_TIMEOUT_MS = 10 * 1000
const MAX_ROOMS = 100

const closeMalformed = (socket) => socket.close(1003, "Malformed collaboration message")

const reject = (socket) => {
  sendCollaborationMessage(
    socket,
    JSON.stringify({
      type: "rejected",
      reason: "schema-incompatible",
      expectedSchemaVersion: SCHEMA_VERSION,
    }),
  )
  socket.close(1008, "Schema incompatible")
}

export const attachCollaboration = (server, options = {}) => {
  const rooms = new Map()
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES })

  const destroyRoom = (roomName, room) => {
    if (room.cleanupTimer !== null) clearTimeout(room.cleanupTimer)
    if (room.saveTimer !== null) {
      clearTimeout(room.saveTimer)
      room.saveTimer = null
      if (options.store !== undefined) room.saving = options.store.save(roomName, Y.encodeStateAsUpdate(room.doc))
    }
    room.saving.catch(() => undefined)
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
    if (options.authorize !== undefined && !options.authorize(request, roomName, "read")) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n")
      socket.destroy()
      return
    }
    const canWrite = options.authorize === undefined || options.authorize(request, roomName, "write")
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request, roomName, canWrite)
    })
  })

  webSocketServer.on("connection", (socket, _request, roomName, canWrite) => {
    let room = null
    const handshakeTimer = setTimeout(
      () => socket.close(1008, "Handshake timed out"),
      HANDSHAKE_TIMEOUT_MS,
    )
    handshakeTimer.unref()
    socket.on("error", () => socket.close())
    socket.once("message", async (raw, isBinary) => {
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
        const persistedUpdate = options.store === undefined ? null : await options.store.load(roomName)
        room = rooms.get(roomName) ?? createCollaborationRoom(initialUpdate, persistedUpdate)
      } catch {
        socket.close(1008, "Invalid initial document")
        return
      }
      if (!rooms.has(roomName)) {
        rooms.set(roomName, room)
        wireCollaborationRoom({ room, roomName, store: options.store })
        if (options.store !== undefined)
          room.saving = options.store.save(roomName, Y.encodeStateAsUpdate(room.doc))
      }
      if (room.cleanupTimer !== null) {
        clearTimeout(room.cleanupTimer)
        room.cleanupTimer = null
      }
      room.connections.set(socket, new Set())
      sendCollaborationMessage(socket, JSON.stringify({ type: "ready", schemaVersion: SCHEMA_VERSION }))
      sendCollaborationMessage(
        socket,
        encodeCollaborationMessage(MESSAGE_SYNC, (encoder) => syncProtocol.writeSyncStep1(encoder, room.doc)),
      )
      const presentClients = [...room.awareness.getStates().keys()]
      if (presentClients.length > 0) {
        sendCollaborationMessage(
          socket,
          encodeCollaborationMessage(MESSAGE_AWARENESS, (encoder) =>
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
            const permissionDecoder = decoding.createDecoder(new Uint8Array(message))
            decoding.readVarUint(permissionDecoder)
            const syncType = decoding.readVarUint(permissionDecoder)
            if (!canWrite && syncType !== 0) {
              socket.close(1008, "Write access required")
              return
            }
            const reply = encoding.createEncoder()
            encoding.writeVarUint(reply, MESSAGE_SYNC)
            syncProtocol.readSyncMessage(decoder, reply, room.doc, socket)
            const response = encoding.toUint8Array(reply)
            if (response.byteLength > 1) sendCollaborationMessage(socket, response)
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

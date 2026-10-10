import * as encoding from "lib0/encoding"
import { WebSocket } from "ws"
import * as awarenessProtocol from "y-protocols/awareness"
import * as syncProtocol from "y-protocols/sync"
import * as Y from "yjs"

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

export const sendCollaborationMessage = (socket, payload) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(payload)
}

export const encodeCollaborationMessage = (type, writePayload) => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, type)
  writePayload(encoder)
  return encoding.toUint8Array(encoder)
}

export const createCollaborationRoom = (initialUpdate, persistedUpdate) => {
  const doc = new Y.Doc()
  const update = persistedUpdate ?? initialUpdate
  if (update.byteLength > 0) Y.applyUpdate(doc, update)
  const awareness = new awarenessProtocol.Awareness(doc)
  awareness.setLocalState(null)
  return {
    doc,
    awareness,
    connections: new Map(),
    cleanupTimer: null,
    saveTimer: null,
    saving: Promise.resolve(),
  }
}

const broadcast = (room, payload, origin) => {
  for (const socket of room.connections.keys()) {
    if (socket !== origin) sendCollaborationMessage(socket, payload)
  }
}

export const wireCollaborationRoom = ({ room, roomName, store }) => {
  room.doc.on("update", (update, origin) => {
    const payload = encodeCollaborationMessage(MESSAGE_SYNC, (encoder) =>
      syncProtocol.writeUpdate(encoder, update),
    )
    broadcast(room, payload, origin)
    if (store !== undefined) {
      clearTimeout(room.saveTimer)
      room.saveTimer = setTimeout(() => {
        room.saveTimer = null
        room.saving = store.save(roomName, Y.encodeStateAsUpdate(room.doc))
      }, 50)
      room.saveTimer.unref()
    }
  })
  room.awareness.on("update", ({ added, updated, removed }, origin) => {
    const controlled = room.connections.get(origin)
    if (controlled !== undefined) {
      for (const clientId of [...added, ...updated]) controlled.add(clientId)
      for (const clientId of removed) controlled.delete(clientId)
    }
    const changed = [...added, ...updated, ...removed]
    const payload = encodeCollaborationMessage(MESSAGE_AWARENESS, (encoder) =>
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, changed),
      ),
    )
    broadcast(room, payload, origin)
  })
}

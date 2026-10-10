import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import { prosemirrorToYDoc } from "y-prosemirror"
import * as awarenessProtocol from "y-protocols/awareness"
import * as syncProtocol from "y-protocols/sync"
import * as Y from "yjs"
import { z } from "zod"
import type { BlockDocument } from "../../core/types"
import { snapshotToPm } from "../../pm/snapshot"

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const SCHEMA_VERSION = "block-editor/v0.3"
const RECONNECT_DELAY_MS = 600

const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), schemaVersion: z.literal(SCHEMA_VERSION) }),
  z.object({
    type: z.literal("rejected"),
    reason: z.literal("schema-incompatible"),
    expectedSchemaVersion: z.string(),
  }),
])

export type CollaborationStatus =
  | "offline"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "incompatible"

export type CollaborationUser = {
  readonly name: string
  readonly color: string
}

type BindingOptions = {
  readonly room: string
  readonly user: CollaborationUser
  readonly initialDocument: BlockDocument
  readonly endpoint?: string
}

const toBase64 = (value: Uint8Array): string => {
  let binary = ""
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const encodeMessage = (type: number, write: (encoder: encoding.Encoder) => void): Uint8Array => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, type)
  write(encoder)
  return encoding.toUint8Array(encoder)
}

export const createInitialCollaborationUpdate = (document: BlockDocument): Uint8Array => {
  const seeded = prosemirrorToYDoc(snapshotToPm(document), "prosemirror")
  const update = Y.encodeStateAsUpdate(seeded)
  seeded.destroy()
  return update
}

export class CollaborationBinding {
  readonly doc = new Y.Doc()
  readonly awareness = new awarenessProtocol.Awareness(this.doc)
  readonly fragment = this.doc.getXmlFragment("prosemirror")
  private readonly options: BindingOptions
  private readonly initialUpdate: Uint8Array
  private readonly statusListeners = new Set<(status: CollaborationStatus) => void>()
  private readonly presenceListeners = new Set<() => void>()
  private readonly remoteClientIds = new Set<number>()
  private socket: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private desiredConnection = false
  private hasSynced = false
  private status: CollaborationStatus = "offline"

  constructor(options: BindingOptions) {
    this.options = options
    this.initialUpdate = createInitialCollaborationUpdate(options.initialDocument)
    this.awareness.setLocalStateField("user", options.user)
    this.doc.on("update", this.handleDocumentUpdate)
    this.awareness.on("update", this.handleAwarenessUpdate)
    this.awareness.on("change", this.notifyPresence)
  }

  get connectionStatus(): CollaborationStatus {
    return this.status
  }

  get users(): readonly CollaborationUser[] {
    return [...this.awareness.getStates().values()].flatMap((state) => {
      const parsed = z
        .object({ user: z.object({ name: z.string(), color: z.string() }) })
        .safeParse(state)
      return parsed.success ? [parsed.data.user] : []
    })
  }

  connect(): void {
    if (this.socket !== null) return
    this.desiredConnection = true
    this.awareness.setLocalStateField("user", this.options.user)
    this.setStatus(this.status === "offline" ? "connecting" : "reconnecting")
    const base =
      this.options.endpoint ??
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/collaboration`
    const url = new URL(base)
    url.searchParams.set("room", this.options.room)
    const socket = new WebSocket(url)
    socket.binaryType = "arraybuffer"
    this.socket = socket
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return
      socket.send(
        JSON.stringify({
          type: "hello",
          schemaVersion: SCHEMA_VERSION,
          initialUpdate: toBase64(
            this.hasSynced ? Y.encodeStateAsUpdate(this.doc) : this.initialUpdate,
          ),
        }),
      )
    })
    socket.addEventListener("message", this.handleSocketMessage)
    socket.addEventListener("close", this.handleSocketClose)
  }

  disconnect(): void {
    this.desiredConnection = false
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.sendAwareness([this.awareness.clientID], new Map())
    this.socket?.close(1000, "Offline requested")
    this.socket = null
    this.clearRemotePresence()
    this.setStatus("offline")
  }

  subscribeStatus(listener: (status: CollaborationStatus) => void): () => void {
    this.statusListeners.add(listener)
    listener(this.status)
    return () => this.statusListeners.delete(listener)
  }

  subscribePresence(listener: () => void): () => void {
    this.presenceListeners.add(listener)
    listener()
    return () => this.presenceListeners.delete(listener)
  }

  destroy(): void {
    this.disconnect()
    this.doc.off("update", this.handleDocumentUpdate)
    this.awareness.off("update", this.handleAwarenessUpdate)
    this.awareness.off("change", this.notifyPresence)
    this.awareness.destroy()
    this.doc.destroy()
  }

  private readonly handleDocumentUpdate = (update: Uint8Array, origin: unknown): void => {
    if (
      origin === this ||
      this.socket?.readyState !== WebSocket.OPEN ||
      this.status !== "connected"
    )
      return
    this.socket.send(
      encodeMessage(MESSAGE_SYNC, (encoder) => syncProtocol.writeUpdate(encoder, update)),
    )
  }

  private readonly handleAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin === this || this.status !== "connected") return
    this.sendAwareness([...changes.added, ...changes.updated, ...changes.removed])
  }

  private readonly handleSocketMessage = (event: MessageEvent<string | ArrayBuffer>): void => {
    if (event.currentTarget !== this.socket) return
    if (typeof event.data === "string") {
      const message = serverMessageSchema.parse(JSON.parse(event.data))
      if (message.type === "rejected") {
        this.desiredConnection = false
        this.setStatus("incompatible")
        return
      }
      this.socket?.send(
        encodeMessage(MESSAGE_SYNC, (encoder) => syncProtocol.writeSyncStep1(encoder, this.doc)),
      )
      return
    }
    const decoder = decoding.createDecoder(new Uint8Array(event.data))
    const type = decoding.readVarUint(decoder)
    if (type === MESSAGE_SYNC) {
      const reply = encoding.createEncoder()
      encoding.writeVarUint(reply, MESSAGE_SYNC)
      const syncMessage = syncProtocol.readSyncMessage(decoder, reply, this.doc, this)
      const response = encoding.toUint8Array(reply)
      if (response.byteLength > 1) this.socket?.send(response)
      if (syncMessage === syncProtocol.messageYjsSyncStep2) {
        this.hasSynced = true
        this.setStatus("connected")
        this.sendAwareness([this.awareness.clientID])
      }
      return
    }
    if (type === MESSAGE_AWARENESS) {
      const update = decoding.readVarUint8Array(decoder)
      const before = new Set(this.awareness.getStates().keys())
      awarenessProtocol.applyAwarenessUpdate(this.awareness, update, this)
      for (const clientId of this.awareness.getStates().keys()) {
        if (!before.has(clientId) && clientId !== this.awareness.clientID)
          this.remoteClientIds.add(clientId)
      }
    }
  }

  private readonly handleSocketClose = (event: CloseEvent): void => {
    if (event.currentTarget !== this.socket) return
    this.socket = null
    this.clearRemotePresence()
    if (!this.desiredConnection || this.status === "incompatible") return
    this.setStatus("reconnecting")
    this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS)
  }

  private sendAwareness(
    clientIds: readonly number[],
    states?: Map<number, Record<string, unknown>>,
  ): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...clientIds], states)
    this.socket.send(
      encodeMessage(MESSAGE_AWARENESS, (encoder) => encoding.writeVarUint8Array(encoder, update)),
    )
  }

  private clearRemotePresence(): void {
    awarenessProtocol.removeAwarenessStates(this.awareness, [...this.remoteClientIds], this)
    this.remoteClientIds.clear()
  }

  private setStatus(status: CollaborationStatus): void {
    this.status = status
    for (const listener of this.statusListeners) listener(status)
  }

  private readonly notifyPresence = (): void => {
    for (const listener of this.presenceListeners) listener()
  }
}

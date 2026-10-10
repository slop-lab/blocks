import * as encoding from "lib0/encoding"
import { afterEach, expect, it, vi } from "vitest"
import * as syncProtocol from "y-protocols/sync"
import * as Y from "yjs"
import { CollaborationBinding } from "../src/features/collaboration/CollaborationBinding"

class Socket extends EventTarget {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 0
  binaryType = "arraybuffer"
  readonly sent: unknown[] = []
  constructor(_url: URL) {
    super()
    Socket.instances.push(this)
  }
  send(data: unknown) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.dispatchEvent(new Event("open"))
  }
}
const socket = () => {
  const last = Socket.instances.at(-1)
  if (last === undefined) throw new Error("No socket")
  return last
}
const create = () => {
  Socket.instances = []
  vi.stubGlobal("WebSocket", Socket)
  return new CollaborationBinding({
    room: "local",
    endpoint: "ws://localhost/collaboration",
    user: { name: "test", color: "blue" },
    initialDocument: { format: "block-editor/v0.3", blocks: [] },
  })
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it("ignores a late old-socket close after a new connection was opened", () => {
  vi.useFakeTimers()
  const binding = create()
  try {
    binding.connect()
    const old = socket()
    old.open()
    binding.disconnect()
    binding.connect()
    const current = socket()
    current.open()
    old.dispatchEvent(new Event("close"))
    expect(binding.connectionStatus).toBe("connecting")
    vi.advanceTimersByTime(1000)
    expect(Socket.instances).toHaveLength(2)
  } finally {
    binding.destroy()
  }
})

it("seeds a recreated room from the current replica rather than an obsolete initial document", () => {
  const binding = create()
  const remote = new Y.Doc()
  try {
    binding.connect()
    const first = socket()
    first.open()
    const frame = encoding.createEncoder()
    encoding.writeVarUint(frame, 0)
    syncProtocol.writeSyncStep2(frame, remote)
    first.dispatchEvent(
      new MessageEvent("message", { data: new Uint8Array(encoding.toUint8Array(frame)).buffer }),
    )
    binding.disconnect()
    binding.doc.getText("draft").insert(0, "offline work")
    binding.connect()
    const resumed = socket()
    resumed.open()
    const hello = resumed.sent.find((message) => typeof message === "string")
    if (typeof hello !== "string") throw new Error("No handshake")
    const decoded: unknown = JSON.parse(hello)
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("initialUpdate" in decoded) ||
      typeof decoded.initialUpdate !== "string"
    )
      throw new Error("Invalid handshake")
    const restored = new Y.Doc()
    Y.applyUpdate(restored, Buffer.from(decoded.initialUpdate, "base64"))
    expect(restored.getText("draft").toString()).toBe("offline work")
    restored.destroy()
  } finally {
    binding.destroy()
    remote.destroy()
  }
})

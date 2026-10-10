// @vitest-environment jsdom

import { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CollaborationWorkspace } from "../src/features/collaboration/CollaborationWorkspace"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
})

let host: HTMLDivElement | null = null

afterEach(() => {
  vi.unstubAllGlobals()
  host?.remove()
  host = null
})

describe("collaboration workspace lifecycle", () => {
  it("closes bindings from StrictMode's discarded effect and the mounted workspace", async () => {
    const sockets: Array<{ closed: boolean }> = []
    class FakeWebSocket {
      static readonly OPEN = 1
      readonly binaryType = "arraybuffer"
      readonly readyState = 0
      closed = false

      constructor(_url: URL) {
        sockets.push(this)
      }

      addEventListener(): void {}
      send(): void {}
      close(): void {
        this.closed = true
      }
    }
    vi.stubGlobal("WebSocket", FakeWebSocket)
    host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)

    await act(async () =>
      root.render(
        <StrictMode>
          <CollaborationWorkspace />
        </StrictMode>,
      ),
    )
    expect(host.querySelector("main")).toBeNull()
    expect(host.querySelector("section[aria-label='실시간 공동 편집']")).not.toBeNull()
    expect(host.textContent).not.toContain("OPTIONAL PROFILE")
    expect(host.textContent).not.toContain("INDEPENDENT SURFACE")
    expect(sockets).toHaveLength(4)
    expect(sockets.slice(0, 2).every((socket) => socket.closed)).toBe(true)
    expect(sockets.slice(2).every((socket) => !socket.closed)).toBe(true)

    await act(async () => root.unmount())
    expect(sockets.every((socket) => socket.closed)).toBe(true)
  })
})

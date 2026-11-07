// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { App } from "../src/App"
import { ReviewDialog } from "../src/components/ReviewDialog"
import type { SuggestionProvider } from "../src/core/proposals"
import type { BlockDocument } from "../src/core/types"

vi.mock("../src/features/collaboration/CollaborationWorkspace", () => ({
  CollaborationWorkspace: () => <p data-mounted="collaboration">Mounted</p>,
}))
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true })

it("does not mount an optional provider when IME rejects navigation", async () => {
  localStorage.clear()
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<App />))
    const editor = host.querySelector(".ProseMirror")
    const navigate = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Write together"),
    )
    if (editor === null || navigate === undefined) throw new TypeError("Workspace controls missing")
    await act(async () =>
      editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
    )
    await act(async () => navigate.click())
    expect(host.querySelector('[data-mounted="collaboration"]')).toBeNull()
    expect(navigate.getAttribute("aria-current")).toBeNull()
    expect(host.querySelector(".canvas .ProseMirror")).not.toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

it.each(["empty", "error"])(
  "invalidates an old candidate when the replacement provider is %s",
  async (behavior) => {
    const before: BlockDocument = { format: "block-editor/v0.3", blocks: [] }
    const candidate: BlockDocument = {
      ...before,
      blocks: [
        {
          id: "old",
          type: "paragraph",
          attrs: {},
          content: [{ kind: "text", text: "Old suggestion", marks: [] }],
        },
      ],
    }
    const provider: SuggestionProvider = async function* () {
      if (behavior === "error") throw new Error("Provider unavailable")
      yield* []
    }
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    const accept = vi.fn()
    try {
      await act(async () =>
        root.render(
          <ReviewDialog
            before={before}
            candidate={candidate}
            onClose={() => {}}
            onAccept={accept}
            provider={provider}
          />,
        ),
      )
      const buttons = [...host.querySelectorAll("button")]
      const generate = buttons.find((button) => button.textContent === "Generate revision")
      const apply = buttons.find((button) => button.textContent === "Accept selected changes")
      expect(apply?.disabled).toBe(false)
      await act(async () => generate?.click())
      expect(apply?.disabled).toBe(true)
      expect(host.textContent).not.toContain("Old suggestion")
      expect(accept).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  },
)

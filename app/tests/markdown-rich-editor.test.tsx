// @vitest-environment jsdom

import { parseMarkdown } from "@slop-lab/blocks-markdown"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createMarkdownEditorState,
  MarkdownRichEditor,
} from "../src/features/markdown/MarkdownRichEditor"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe("Markdown rich editor transaction boundaries", () => {
  it("rejects a transaction that deletes a locked opaque block", () => {
    const state = createMarkdownEditorState(parseMarkdown("<span>locked</span>\n").document)

    const result = state.applyTransaction(state.tr.delete(0, state.doc.content.size))

    expect(result.transactions).toHaveLength(0)
    expect(result.state.doc.eq(state.doc)).toBe(true)
  })

  it("defers an external source reset until composition input has flushed", async () => {
    const render = (source: string) =>
      root.render(
        <MarkdownRichEditor
          source={source}
          hidden={false}
          onChange={() => undefined}
          onCompositionChange={() => undefined}
          onSave={() => undefined}
        />,
      )
    await act(async () => render("Before\n"))
    const editor = host.querySelector<HTMLElement>("[aria-label='Markdown 문서 편집기']")
    if (editor === null) throw new TypeError("Markdown editor did not mount")

    await act(async () =>
      editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
    )
    await act(async () => render("After\n"))
    expect(editor.textContent).toContain("Before")

    await act(async () => {
      editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(editor.textContent).toContain("After")
  })

  it("handles Mod-S inside the active editor exactly once", async () => {
    const onSave = vi.fn()
    await act(async () =>
      root.render(
        <MarkdownRichEditor
          source="Draft\n"
          hidden={false}
          onChange={() => undefined}
          onCompositionChange={() => undefined}
          onSave={onSave}
        />,
      ),
    )
    const editor = host.querySelector<HTMLElement>("[aria-label='Markdown 문서 편집기']")
    if (editor === null) throw new TypeError("Markdown editor did not mount")

    const event = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    await act(async () => editor.dispatchEvent(event))

    expect(event.defaultPrevented).toBe(true)
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})

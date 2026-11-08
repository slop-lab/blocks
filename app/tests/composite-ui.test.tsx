// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import { CompositeWorkspace } from "../src/features/composite/CompositeWorkspace"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
})

let host: HTMLDivElement | null = null

afterEach(() => {
  host?.remove()
  host = null
})

describe("composite active toolbar", () => {
  it("routes shared controls to the independently focused editor context", async () => {
    host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(<CompositeWorkspace />))
    const toolbar = host.querySelector<HTMLElement>("[role='toolbar']")
    const codeEditor = host.querySelector<HTMLElement>(
      "[aria-label='Travel preparation code editor']",
    )
    if (toolbar === null || codeEditor === null)
      throw new TypeError("Composite editors did not mount")

    expect(toolbar.textContent).toContain("Document tools")
    await act(async () => codeEditor.focus())

    expect(toolbar.textContent).toContain("Code tools")
    expect(host.querySelector("[aria-label='Select all code']")).not.toBeNull()
    await act(async () => root.unmount())
  })
})

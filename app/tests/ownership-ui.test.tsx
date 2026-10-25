// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { OwnershipExamplesWorkspace } from "../src/features/ownership/OwnershipExamplesWorkspace"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true })
Object.defineProperty(globalThis, "CSS", {
  configurable: true,
  value: { escape: (value: string) => value },
})
Object.defineProperty(Range.prototype, "getClientRects", {
  configurable: true,
  value: () => [],
})
Object.defineProperty(Range.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0 }),
})

vi.mock("../src/features/ownership/mixed-api", () => ({
  loadMixed: vi.fn(),
  changeTaskStatus: vi.fn(),
  savePresentation: vi.fn(),
  saveProposal: vi.fn(),
}))

let host: HTMLDivElement | null = null
afterEach(() => {
  host?.remove()
  host = null
  localStorage.clear()
})

const render = async () => {
  host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<OwnershipExamplesWorkspace />))
  return { root, host }
}

it("renders the status projection itself without an editable surface", async () => {
  const view = await render()
  const tab = Array.from(view.host.querySelectorAll("button")).find(
    (item) => item.textContent === "Status view",
  )
  await act(async () => tab?.click())

  expect(view.host.textContent).toContain("Release status view")
  const status = view.host.querySelector('[aria-labelledby="status-title"]')
  expect(status?.querySelector(".ProseMirror")).toBeNull()
  expect(status?.querySelector("[contenteditable]")).toBeNull()
  await act(async () => view.root.unmount())
})

it("duplicates one presentation occurrence without deleting its domain task", async () => {
  const view = await render()
  const tab = Array.from(view.host.querySelectorAll("button")).find(
    (item) => item.textContent === "Project board",
  )
  await act(async () => tab?.click())
  const duplicate = Array.from(view.host.querySelectorAll("button")).find(
    (item) => item.textContent === "Duplicate card",
  )
  await act(async () => duplicate?.click())

  expect(
    view.host.querySelectorAll('[aria-label="Project board presentation editor"] .ownership-card'),
  ).toHaveLength(3)
  expect(view.host.textContent).toContain("2 domain tasks")

  const editor = view.host.querySelector(
    '[aria-label="Project board presentation editor"] .ProseMirror',
  )
  await act(async () => {
    editor?.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }))
  })
  expect(
    view.host.querySelectorAll('[aria-label="Project board presentation editor"] .ownership-card'),
  ).toHaveLength(2)
  await act(async () => view.root.unmount())
})

it("falls back to the initial board when persisted JSON is malformed", async () => {
  localStorage.setItem("ownership.project-board.presentation", "not-json")
  const view = await render()
  const tab = Array.from(view.host.querySelectorAll("button")).find(
    (item) => item.textContent === "Project board",
  )
  await act(async () => tab?.click())

  expect(
    view.host.querySelectorAll('[aria-label="Project board presentation editor"] .ownership-card'),
  ).toHaveLength(2)
  await act(async () => view.root.unmount())
})

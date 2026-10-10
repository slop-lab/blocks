// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { OwnershipExamplesWorkspace } from "../src/features/ownership/OwnershipExamplesWorkspace"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true })

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
    (item) => item.textContent === "상태 보기",
  )
  await act(async () => tab?.click())

  expect(view.host.textContent).toContain("출시 상태 보기")
  const status = view.host.querySelector('[aria-labelledby="status-title"]')
  expect(status?.querySelector(".ProseMirror")).toBeNull()
  expect(status?.querySelector("[contenteditable]")).toBeNull()
  await act(async () => view.root.unmount())
})

it("duplicates one presentation occurrence without deleting its domain task", async () => {
  const view = await render()
  const tab = Array.from(view.host.querySelectorAll("button")).find(
    (item) => item.textContent === "프로젝트 보드",
  )
  await act(async () => tab?.click())
  const duplicate = Array.from(view.host.querySelectorAll("button")).find(
    (item) => item.textContent === "카드 복제",
  )
  await act(async () => duplicate?.click())

  expect(
    view.host.querySelectorAll('[aria-label="프로젝트 보드 표현 편집기"] .ownership-card'),
  ).toHaveLength(3)
  expect(view.host.textContent).toContain("도메인 작업 2개")
  await act(async () => view.root.unmount())
})

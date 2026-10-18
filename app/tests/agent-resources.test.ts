// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, expect, it, vi } from "vitest"
import { AgentWorkbench } from "../src/features/agent-workbench/AgentWorkbench"
import { loadAgentResources } from "../src/features/agent-workbench/agent-api"

const { get } = vi.hoisted(() => ({
  get: vi.fn<(path: string) => { readonly json: () => Promise<unknown> }>(),
}))

vi.mock("ky", () => ({
  default: { get },
}))

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true })

beforeEach(() => {
  get.mockImplementation((path) => ({
    json: async () => {
      switch (path) {
        case "/api/markdown":
          return { files: ["README.md"] }
        case "/api/workspace":
          return {
            databases: [{ documentId: "tasks", revision: 3, content: { name: "Project tasks" } }],
          }
        case "/api/ownership/mixed":
          throw new Error(
            "Request failed with status code 400 Bad Request: GET /api/ownership/mixed",
          )
        case "/api/agent/models":
          return {
            models: [{ id: "fixture/deterministic", providerLabel: "Fixture" }],
            defaultModel: "fixture/deterministic",
          }
        default:
          throw new TypeError(`Unexpected resource path: ${path}`)
      }
    },
  }))
})

it("keeps Markdown and database resources when the mixed catalog fails", async () => {
  const resources = await loadAgentResources()

  expect(resources.markdown).toEqual(["README.md"])
  expect(resources.databases.map((database) => database.documentId)).toEqual(["tasks"])
  expect(resources.tasks).toBeNull()
  expect(resources.errors).toEqual({
    mixed: "Request failed with status code 400 Bad Request: GET /api/ownership/mixed",
  })
})

it("shows the mixed failure only on its disabled story while Markdown stays selectable", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)

  await act(async () => root.render(createElement(AgentWorkbench)))

  const resourceSelect = Array.from(host.querySelectorAll<HTMLSelectElement>("select")).find(
    (select) => select.labels.item(0)?.textContent?.includes("권한 있는 원본"),
  )
  expect(resourceSelect?.value).toBe("README.md")
  expect(resourceSelect?.disabled).toBe(false)
  expect(host.querySelector('[role="alert"]')).toBeNull()

  const mixedTab = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (tab) => tab.textContent?.includes("혼합 백로그"),
  )
  await act(async () => mixedTab?.click())

  expect(resourceSelect?.disabled).toBe(true)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Request failed with status code 400 Bad Request: GET /api/ownership/mixed",
  )
  expect(host.querySelector<HTMLButtonElement>(".button--primary")?.disabled).toBe(true)

  await act(async () => root.unmount())
  host.remove()
})

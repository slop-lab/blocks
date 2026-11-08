// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, expect, it, vi } from "vitest"
import { AgentModelSelect } from "../src/features/agent-workbench/AgentModelSelect"
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

it("exposes the complete selected model outside the single-line option", async () => {
  // Given a selected model returned by the server catalog.
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  try {
    // When the shared model selector loads its catalog.
    await act(async () =>
      root.render(
        createElement(AgentModelSelect, { value: "fixture/deterministic", onChange: vi.fn() }),
      ),
    )

    // Then its accessible description exposes the identity in wrapping content.
    const select = host.querySelector("select")
    const detailsId = select?.getAttribute("aria-describedby")
    const details = detailsId ? document.getElementById(detailsId) : null
    expect(details?.textContent).toContain("fixture/deterministic")
    expect(details?.textContent).toContain("Fixture")
    expect(details?.closest("select")).toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

it("shows the mixed failure only on its disabled story while Markdown stays selectable", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)

  await act(async () => root.render(createElement(AgentWorkbench)))

  const resourceSelect = Array.from(host.querySelectorAll<HTMLSelectElement>("select")).find(
    (select) => select.labels.item(0)?.textContent?.includes("Authorized source"),
  )
  expect(resourceSelect?.value).toBe("README.md")
  expect(resourceSelect?.disabled).toBe(false)
  expect(host.querySelector('[role="alert"]')).toBeNull()

  const mixedTab = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (tab) => tab.textContent?.includes("Mixed backlog"),
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

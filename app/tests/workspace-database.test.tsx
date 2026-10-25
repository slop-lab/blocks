// @vitest-environment jsdom

import type { Database } from "@slop-lab/blocks-workspace"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { WorkspaceDatabase } from "../src/features/workspace/WorkspaceDatabase"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true })

it("filters with the configured status property without changing the input database", async () => {
  const database: Database = {
    id: "tasks",
    version: 1,
    name: "Tasks",
    properties: [
      { id: "name", name: "Name", type: "text" },
      {
        id: "workflowState",
        name: "Workflow state",
        type: "status",
        options: ["Queued", "Ready"],
      },
    ],
    rows: [
      { id: "queued", values: { name: "Draft", workflowState: "Queued" } },
      { id: "ready", values: { name: "Ship", workflowState: "Ready" } },
    ],
  }
  const before = structuredClone(database)
  const onChange = vi.fn()
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)

  try {
    await act(async () =>
      root.render(<WorkspaceDatabase database={database} onChange={onChange} />),
    )
    const filter = host.querySelector<HTMLSelectElement>(
      'select[aria-label="Filter by Workflow state"]',
    )
    if (filter === null) throw new TypeError("Status filter did not mount")

    expect(Array.from(filter.options, (option) => [option.value, option.text])).toEqual([
      ["", "All Workflow state values"],
      ["Queued", "Queued"],
      ["Ready", "Ready"],
    ])

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
      setter?.call(filter, "Ready")
      filter.dispatchEvent(new Event("change", { bubbles: true }))
    })

    const visibleRows = host.querySelectorAll("tbody tr")
    expect(visibleRows).toHaveLength(1)
    expect(
      visibleRows[0]?.querySelector<HTMLInputElement>('input[aria-label="ready Name"]')?.value,
    ).toBe("Ship")
    expect(onChange).not.toHaveBeenCalled()
    expect(database).toEqual(before)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

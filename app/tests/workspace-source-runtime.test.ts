// @vitest-environment jsdom

import { syncedSourceSchema } from "@block-editor/workspace"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { EntityRecord } from "../src/features/workspace/workspace-api"
import type { WorkspaceNodeViewData } from "../src/features/workspace/workspace-node-view-types"
import { WorkspaceSourceRuntime } from "../src/features/workspace/workspace-source-runtime"

const record = (
  revision: number,
  text: string,
): EntityRecord<ReturnType<typeof syncedSourceSchema.parse>> => ({
  documentId: "shared-source",
  revision,
  content: syncedSourceSchema.parse({
    id: "shared-source",
    version: revision,
    section: {
      id: "shared-root",
      type: "section",
      heading: "Shared title",
      children: [{ id: "shared-paragraph", type: "paragraph", text }],
    },
  }),
  metadata: {},
  history: [],
})

const dataPointer = (runtime: WorkspaceSourceRuntime, depth: number) => ({
  current: {
    workspace: { id: "workspace", version: 1, pages: [] },
    databases: [],
    sources: [record(1, "Initial")],
    profile: runtime.profile,
    onOpenPage: () => {},
    onSourceEdit: () => {},
    onSourceCreate: async () => null,
    onSourceCompositionChange: () => {},
    onSourceConflictResolve: () => {},
    embeddingDepth: depth,
  } satisfies WorkspaceNodeViewData,
})

afterEach(() => {
  vi.useRealTimers()
})

describe("WorkspaceSourceRuntime occurrence lifecycle", () => {
  it("Given the final occurrence is detached, When the retention window expires, Then a remount opens the latest source record", () => {
    vi.useFakeTimers()
    const runtime = new WorkspaceSourceRuntime()
    const firstHost = document.createElement("div")
    const first = runtime.attach(record(1, "Initial"), "first", firstHost, dataPointer(runtime, 1))

    first.destroy()
    vi.runAllTimers()
    const secondHost = document.createElement("div")
    runtime.attach(record(2, "Remote replacement"), "second", secondHost, dataPointer(runtime, 1))

    expect(secondHost.querySelector("p")?.textContent).toBe("Remote replacement")
    runtime.dispose()
  })

  it("Given an unchanged source and context, When the occurrence refreshes, Then the projection DOM is retained", () => {
    const runtime = new WorkspaceSourceRuntime()
    const host = document.createElement("div")
    const source = record(1, "Initial")
    const attachment = runtime.attach(source, "first", host, dataPointer(runtime, 1))
    const paragraph = host.querySelector("p")

    attachment.refresh(source)

    expect(host.querySelector("p")).toBe(paragraph)
    runtime.dispose()
  })

  it("Given the same source at a deeper embedding, When its occurrence refreshes, Then its title heading level updates without changing source content", () => {
    const runtime = new WorkspaceSourceRuntime()
    const host = document.createElement("div")
    const source = record(1, "Initial")
    const data = dataPointer(runtime, 1)
    const attachment = runtime.attach(source, "first", host, data)
    expect(host.querySelector('[role="heading"]')?.getAttribute("aria-level")).toBe("2")

    data.current = { ...data.current, embeddingDepth: 3 }
    attachment.refresh(source)

    expect(host.querySelector('[role="heading"]')?.textContent).toBe("Shared title")
    expect(host.querySelector('[role="heading"]')?.getAttribute("aria-level")).toBe("4")
    runtime.dispose()
  })
})

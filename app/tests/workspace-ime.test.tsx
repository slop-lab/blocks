// @vitest-environment jsdom

import { pageDocumentSchema, workspaceSchema } from "@slop-lab/blocks-workspace"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { WorkspaceEditor } from "../src/features/workspace/WorkspaceEditor"
import { WorkspaceSourceRuntime } from "../src/features/workspace/workspace-source-runtime"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true })

afterEach(() => {
  vi.useRealTimers()
})

it("Given a composing local section, When a React update carries a remote snapshot, Then the editor DOM survives and applies the snapshot after compositionend", async () => {
  vi.useFakeTimers()
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const sourceController = new WorkspaceSourceRuntime()
  const workspace = workspaceSchema.parse({
    id: "workspace",
    version: 1,
    pages: [{ id: "page", parentId: null, title: "Page", icon: "file", archived: false }],
  })
  const initial = pageDocumentSchema.parse({
    pageId: "page",
    version: 1,
    blocks: [
      {
        id: "section",
        type: "section",
        heading: "Section",
        children: [{ id: "paragraph", type: "paragraph", text: "Initial" }],
      },
    ],
  })
  const remote = pageDocumentSchema.parse({
    ...initial,
    version: 2,
    blocks: [
      {
        id: "section",
        type: "section",
        heading: "Section",
        children: [{ id: "paragraph", type: "paragraph", text: "Remote" }],
      },
    ],
  })
  const render = (document: typeof initial) =>
    root.render(
      <WorkspaceEditor
        workspace={workspace}
        document={document}
        depth={0}
        databases={[]}
        sources={[]}
        onDocument={() => {}}
        onSourceEdit={() => {}}
        onSourceCreate={async () => null}
        onSourceCompositionChange={() => {}}
        onSourceConflictResolve={() => {}}
        onOpenPage={() => {}}
        onCompositionChange={() => {}}
        pasteMode="clone"
        sourceController={sourceController}
      />,
    )

  try {
    await act(async () => render(initial))
    const editor = host.querySelector<HTMLElement>('[aria-label="구조화 문서 편집기"]')
    const section = host.querySelector<HTMLElement>('[data-block-id="section"]')
    if (editor === null || section === null) throw new TypeError("Workspace editor did not mount")

    await act(async () => {
      editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }))
      render(remote)
    })

    expect(host.querySelector('[data-block-id="section"]')).toBe(section)
    expect(section.textContent).toContain("Initial")

    await act(async () => {
      editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }))
      vi.runAllTimers()
    })

    expect(host.querySelector('[data-block-id="section"]')).toBe(section)
    expect(section.textContent).toContain("Remote")
  } finally {
    await act(async () => root.unmount())
    sourceController.dispose()
    host.remove()
  }
})

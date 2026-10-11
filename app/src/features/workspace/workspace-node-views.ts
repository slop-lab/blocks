import { type ProseMirrorProfile, snapshotToPm } from "@block-editor/prosemirror"
import type { Database, SyncedSource, Workspace } from "@block-editor/workspace"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import type { NodeView, NodeViewConstructor } from "prosemirror-view"
import { pageDocumentToSnapshot } from "./workspace-editor-model"

type WorkspaceNodeViewData = {
  readonly workspace: Workspace
  readonly databases: readonly Database[]
  readonly sources: readonly SyncedSource[]
  readonly profile: ProseMirrorProfile
  readonly onOpenPage: (id: string) => void
  readonly onSourceEdit: (source: SyncedSource) => void
}

export type WorkspaceNodeViews = {
  readonly nodeViews: Readonly<Record<string, NodeViewConstructor>>
  readonly refresh: () => void
  readonly destroy: () => void
}

const button = (label: string, action: () => void): HTMLButtonElement => {
  const element = document.createElement("button")
  element.type = "button"
  element.textContent = label
  element.addEventListener("click", () => {
    element.focus()
    action()
  })
  return element
}

const atomicView = (
  className: string,
  blockId: string,
  render: (dom: HTMLElement) => void,
  renders: Set<() => void>,
): NodeView => {
  const dom = document.createElement("section")
  dom.className = className
  dom.dataset["blockId"] = blockId
  dom.contentEditable = "false"
  const refresh = () => render(dom)
  renders.add(refresh)
  refresh()
  return {
    dom,
    stopEvent: (event) => event.target instanceof Node && dom.contains(event.target),
    destroy: () => renders.delete(refresh),
  }
}

export const createWorkspaceNodeViews = (data: {
  current: WorkspaceNodeViewData
}): WorkspaceNodeViews => {
  const renders = new Set<() => void>()
  const nodeViews: Readonly<Record<string, NodeViewConstructor>> = {
    workspace_page_ref: (node) =>
      atomicView(
        "structured-page-ref",
        String(node.attrs["id"]),
        (dom) => {
          const pageId = String(node.attrs["pageId"])
          const page = data.current.workspace.pages.find((candidate) => candidate.id === pageId)
          dom.replaceChildren(
            button(`연결된 페이지 · ${page?.title ?? pageId}`, () =>
              data.current.onOpenPage(pageId),
            ),
          )
        },
        renders,
      ),
    workspace_database_embed: (node) =>
      atomicView(
        "structured-database-ref",
        String(node.attrs["id"]),
        (dom) => {
          const databaseId = String(node.attrs["databaseId"])
          const database = data.current.databases.find((candidate) => candidate.id === databaseId)
          dom.textContent = `데이터베이스 · ${database?.name ?? databaseId}`
        },
        renders,
      ),
    workspace_synced_ref: (node, view, getPos) =>
      atomicView(
        "structured-sync",
        String(node.attrs["id"]),
        (dom) => {
          const sourceId = String(node.attrs["sourceId"])
          const source = data.current.sources.find((candidate) => candidate.id === sourceId)
          let header = dom.querySelector<HTMLElement>("header")
          let label = dom.querySelector<HTMLElement>("[data-sync-label]")
          let content = dom.querySelector<HTMLElement>(".structured-sync__content")
          if (header === null || label === null || content === null) {
            header = document.createElement("header")
            label = document.createElement("span")
            label.dataset["syncLabel"] = "true"
            const edit = button("공유 원본 편집", () => {
              const current = data.current.sources.find((candidate) => candidate.id === sourceId)
              if (current !== undefined) data.current.onSourceEdit(current)
            })
            const duplicate = button("복제", () => {
              const position = getPos()
              if (position === undefined) return
              const copy = node.type.create({
                ...node.attrs,
                id: crypto.randomUUID(),
                occurrenceId: crypto.randomUUID(),
              })
              view.dispatch(
                view.state.tr
                  .insert(position + node.nodeSize, copy)
                  .setMeta("origin", "local")
                  .scrollIntoView(),
              )
            })
            const unlink = button("연결 해제", () => {
              const position = getPos()
              const current = data.current.sources.find((candidate) => candidate.id === sourceId)
              if (position === undefined || current === undefined || current.blocks.length === 0)
                return
              const local = {
                pageId: "snapshot",
                version: 1,
                blocks: current.blocks.map((block) => ({ ...block, id: crypto.randomUUID() })),
              }
              const replacement = snapshotToPm(pageDocumentToSnapshot(local), data.current.profile)
              view.dispatch(
                view.state.tr
                  .replaceWith(position, position + node.nodeSize, replacement.content)
                  .setMeta("origin", "local")
                  .scrollIntoView(),
              )
            })
            header.append(label, edit, duplicate, unlink)
            content = document.createElement("div")
            content.className = "structured-sync__content"
            dom.replaceChildren(header, content)
          }
          label.textContent = `공유 블록 · v${source?.version ?? 0}`
          content.replaceChildren()
          for (const block of source?.blocks ?? []) {
            const element = document.createElement(block.type === "heading" ? "strong" : "p")
            element.textContent = block.text
            content.append(element)
          }
          dom.dataset["occurrenceId"] = String(node.attrs["occurrenceId"])
        },
        renders,
      ),
  }
  return {
    nodeViews,
    refresh: () => {
      for (const render of renders) render()
    },
    destroy: () => renders.clear(),
  }
}

export const nodeId = (node: ProseMirrorNode): string | null =>
  typeof node.attrs["id"] === "string" ? node.attrs["id"] : null

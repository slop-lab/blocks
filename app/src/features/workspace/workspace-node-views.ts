import type { Node as ProseMirrorNode } from "prosemirror-model"
import type { NodeView, NodeViewConstructor } from "prosemirror-view"
import { createLocalSectionView } from "./workspace-local-section-view"
import { nodeViewButton, type WorkspaceNodeViewData } from "./workspace-node-view-types"
import type { WorkspaceSourceRuntime } from "./workspace-source-runtime"
import { createSyncedSectionView } from "./workspace-synced-section-view"

export type WorkspaceNodeViews = {
  readonly nodeViews: Readonly<Record<string, NodeViewConstructor>>
  readonly refresh: () => void
  readonly destroy: () => void
}

const atomicView = (
  className: string,
  blockId: string,
  render: (dom: HTMLElement) => void,
  renders: Set<() => void>,
  ownerDocument: Document,
): NodeView => {
  const dom = ownerDocument.createElement("section")
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

export const createWorkspaceNodeViews = (
  data: { current: WorkspaceNodeViewData },
  sourceController: WorkspaceSourceRuntime,
): WorkspaceNodeViews => {
  const renders = new Set<() => void>()
  const nodeViews: Readonly<Record<string, NodeViewConstructor>> = {
    workspace_page_ref: (node, view) =>
      atomicView(
        "structured-page-ref",
        String(node.attrs["id"]),
        (dom) => {
          const pageId = String(node.attrs["pageId"])
          const page = data.current.workspace.pages.find((candidate) => candidate.id === pageId)
          dom.replaceChildren(
            nodeViewButton(view.dom.ownerDocument, `Linked page · ${page?.title ?? pageId}`, () =>
              data.current.onOpenPage(pageId),
            ),
          )
        },
        renders,
        view.dom.ownerDocument,
      ),
    workspace_database_embed: (node, view) =>
      atomicView(
        "structured-database-ref",
        String(node.attrs["id"]),
        (dom) => {
          const databaseId = String(node.attrs["databaseId"])
          const database = data.current.databases.find((candidate) => candidate.id === databaseId)
          dom.textContent = `Database · ${database?.name ?? databaseId}`
        },
        renders,
        view.dom.ownerDocument,
      ),
    section: (node, view, getPos) =>
      String(node.attrs["sourceId"] ?? "").length === 0
        ? createLocalSectionView({ node, view, getPos, data })
        : createSyncedSectionView({
            node,
            view,
            getPos,
            data,
            sourceController,
            renders,
          }),
    section_title: (_node, view, getPos) => {
      const position = getPos()
      if (position === undefined) return { dom: view.dom.ownerDocument.createElement("h1") }
      const resolved = view.state.doc.resolve(position)
      let sectionDepth = data.current.embeddingDepth
      for (let depth = 0; depth <= resolved.depth; depth += 1)
        if (resolved.node(depth).type.name === "section") sectionDepth += 1
      const level = Math.min(6, Math.max(1, sectionDepth))
      const dom = view.dom.ownerDocument.createElement(`h${level}`)
      dom.dataset["semanticDepth"] = String(sectionDepth)
      return { dom, contentDOM: dom }
    },
  }
  return {
    nodeViews,
    refresh: () => {
      for (const render of renders) render()
    },
    destroy: () => {
      renders.clear()
    },
  }
}

export const nodeId = (node: ProseMirrorNode): string | null =>
  typeof node.attrs["id"] === "string" ? node.attrs["id"] : null

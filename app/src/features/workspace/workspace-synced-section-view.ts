import { snapshotToPm } from "@slop-lab/blocks-prosemirror"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import type { EditorView, NodeView } from "prosemirror-view"
import { pageDocumentToSnapshot } from "./workspace-editor-model"
import { applySharedFocusVisibility } from "./workspace-focus-view"
import { freshClone, nodeViewButton, type WorkspaceNodeViewData } from "./workspace-node-view-types"
import type { WorkspaceSourceRuntime } from "./workspace-source-runtime"

type SyncedSectionOptions = {
  readonly node: ProseMirrorNode
  readonly view: EditorView
  readonly getPos: () => number | undefined
  readonly data: { current: WorkspaceNodeViewData }
  readonly sourceController: WorkspaceSourceRuntime
  readonly renders: Set<() => void>
}

export const createSyncedSectionView = ({
  node,
  view,
  getPos,
  data,
  sourceController,
  renders,
}: SyncedSectionOptions): NodeView => {
  const sourceId = String(node.attrs["sourceId"])
  const occurrenceId = String(node.attrs["occurrenceId"] || node.attrs["id"])
  const dom = view.dom.ownerDocument.createElement("section")
  dom.className = "structured-sync"
  dom.dataset["blockId"] = String(node.attrs["id"])
  dom.dataset["occurrenceId"] = occurrenceId
  dom.contentEditable = "false"
  const header = view.dom.ownerDocument.createElement("header")
  const badge = view.dom.ownerDocument.createElement("span")
  badge.className = "structured-sync__badge"
  badge.dataset["syncLabel"] = "true"
  const icon = view.dom.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg")
  icon.setAttribute("viewBox", "0 0 16 16")
  icon.setAttribute("aria-hidden", "true")
  const iconPath = view.dom.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path")
  iconPath.setAttribute(
    "d",
    "M3 5.5A4 4 0 0 1 10 3l1-1v4H7l1.4-1.4A2 2 0 0 0 5 5.5M13 10.5A4 4 0 0 1 6 13l-1 1v-4h4l-1.4 1.4A2 2 0 0 0 11 10.5",
  )
  iconPath.setAttribute("fill", "currentColor")
  icon.append(iconPath)
  badge.append(icon, "Synced")
  const label = view.dom.ownerDocument.createElement("span")
  const duplicate = nodeViewButton(view.dom.ownerDocument, "Duplicate", () => {
    const position = getPos()
    if (position === undefined) return
    view.dispatch(
      view.state.tr
        .insert(
          position + node.nodeSize,
          node.type.create({
            ...node.attrs,
            id: crypto.randomUUID(),
            occurrenceId: crypto.randomUUID(),
          }),
        )
        .setMeta("origin", "local")
        .scrollIntoView(),
    )
  })
  const unlink = nodeViewButton(view.dom.ownerDocument, "Unlink", () => {
    const position = getPos()
    const source = data.current.sources.find(
      (candidate) => candidate.documentId === sourceId,
    )?.content
    if (position === undefined || source?.section.type !== "section") return
    const document = snapshotToPm(
      pageDocumentToSnapshot({
        pageId: source.id,
        version: source.version,
        blocks: [source.section],
      }),
      data.current.profile,
    )
    view.dispatch(
      view.state.tr
        .replaceWith(position, position + node.nodeSize, freshClone(document.child(0)))
        .setMeta("origin", "local")
        .scrollIntoView(),
    )
  })
  const acceptRemote = nodeViewButton(view.dom.ownerDocument, "Accept server changes", () =>
    data.current.onSourceConflictResolve(sourceId, "accept-remote"),
  )
  const keepLocal = nodeViewButton(view.dom.ownerDocument, "Keep local draft", () =>
    data.current.onSourceConflictResolve(sourceId, "keep-local"),
  )
  acceptRemote.hidden = true
  keepLocal.hidden = true
  header.append(badge, label, duplicate, unlink, acceptRemote, keepLocal)
  const host = view.dom.ownerDocument.createElement("div")
  host.className = "structured-sync__content"
  dom.append(header, host)
  const sourceRecord = data.current.sources.find((candidate) => candidate.documentId === sourceId)
  if (sourceRecord === undefined) {
    label.textContent = `${sourceId} · Source unavailable`
    return { dom }
  }
  const attachment = sourceController.attach(sourceRecord, occurrenceId, host, data)
  const refresh = () => {
    const current = data.current.sources.find((candidate) => candidate.documentId === sourceId)
    if (current !== undefined) attachment.refresh(current)
    const conflict = sourceController.conflict(sourceId)
    label.textContent =
      conflict === null
        ? `v${current?.revision ?? sourceRecord.revision}`
        : `v${current?.revision ?? sourceRecord.revision} · Conflict`
    acceptRemote.hidden = conflict === null
    keepLocal.hidden = conflict === null
    applySharedFocusVisibility(dom, data.current.focusTarget)
  }
  refresh()
  renders.add(refresh)
  const unsubscribeStatus = sourceController.subscribe(sourceId, refresh)
  const activate = (event: PointerEvent) => {
    if (event.target instanceof Node && host.contains(event.target)) {
      attachment.activate(event)
      queueMicrotask(refresh)
    }
  }
  const deactivate = (event: FocusEvent) => {
    if (event.relatedTarget instanceof Node && dom.contains(event.relatedTarget)) return
    attachment.deactivate(event)
    queueMicrotask(refresh)
  }
  dom.addEventListener("pointerdown", activate, true)
  dom.addEventListener("focusout", deactivate, true)
  return {
    dom,
    stopEvent: (event) => event.target instanceof Node && dom.contains(event.target),
    destroy: () => {
      dom.removeEventListener("pointerdown", activate, true)
      dom.removeEventListener("focusout", deactivate, true)
      renders.delete(refresh)
      unsubscribeStatus()
      attachment.destroy()
    },
  }
}

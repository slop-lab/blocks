import { pmToSnapshot, snapshotToPm } from "@block-editor/prosemirror"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import { EditorView, type NodeView } from "prosemirror-view"
import { attachBlockInteractions } from "../../pm/block-interactions"
import { createEditorState } from "../../pm/editor"
import { pageDocumentToSnapshot, snapshotToPageDocument } from "./workspace-editor-model"
import {
  freshClone,
  type NestedEditor,
  nodeViewButton,
  type WorkspaceNodeViewData,
} from "./workspace-node-view-types"

type Activity = {
  readonly current: () => string | null
  readonly activate: (occurrenceId: string) => void
  readonly deactivate: (occurrenceId: string) => void
}
type SyncedSectionOptions = {
  readonly node: ProseMirrorNode
  readonly view: EditorView
  readonly getPos: () => number | undefined
  readonly data: { current: WorkspaceNodeViewData }
  readonly editors: Map<string, NestedEditor>
  readonly activity: Activity
}

export const createSyncedSectionView = ({
  node,
  view,
  getPos,
  data,
  editors,
  activity,
}: SyncedSectionOptions): NodeView => {
  const sourceId = String(node.attrs["sourceId"])
  const occurrenceId = String(node.attrs["occurrenceId"] || node.attrs["id"])
  const dom = view.dom.ownerDocument.createElement("section")
  dom.className = "structured-sync"
  dom.dataset["blockId"] = String(node.attrs["id"])
  dom.dataset["occurrenceId"] = occurrenceId
  dom.contentEditable = "false"
  const header = view.dom.ownerDocument.createElement("header")
  const label = view.dom.ownerDocument.createElement("span")
  label.dataset["syncLabel"] = "true"
  const duplicate = nodeViewButton(view.dom.ownerDocument, "복제", () => {
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
  const unlink = nodeViewButton(view.dom.ownerDocument, "연결 해제", () => {
    const position = getPos()
    const source = data.current.sources.find((candidate) => candidate.id === sourceId)
    if (position === undefined || source === undefined || source.section.type !== "section") return
    const sourceDocument = snapshotToPm(
      pageDocumentToSnapshot({
        pageId: source.id,
        version: source.version,
        blocks: [source.section],
      }),
      data.current.profile,
    )
    const local = freshClone(sourceDocument.child(0))
    view.dispatch(
      view.state.tr
        .replaceWith(position, position + node.nodeSize, local)
        .setMeta("origin", "local")
        .scrollIntoView(),
    )
  })
  header.append(label, duplicate, unlink)
  const host = view.dom.ownerDocument.createElement("div")
  host.className = "structured-sync__content"
  dom.append(header, host)
  const source = data.current.sources.find((candidate) => candidate.id === sourceId)
  if (source === undefined) {
    label.textContent = `동기화된 섹션 · ${sourceId} · 원본 없음`
    return { dom }
  }
  label.textContent = `동기화된 섹션 · v${source.version}`
  let sourceVersion = source.version
  let emitted = JSON.stringify(source.section)
  let composing = false
  let compositionTimer: ReturnType<typeof setTimeout> | undefined
  const nestedView = new EditorView(host, {
    state: createEditorState({
      document: snapshotToPm(
        pageDocumentToSnapshot({
          pageId: source.id,
          version: source.version,
          blocks: [source.section],
        }),
        data.current.profile,
      ),
      readonly: false,
      profile: data.current.profile,
    }),
    attributes: {
      class: "structured-sync__editor",
      "aria-label": `동기화된 섹션 ${occurrenceId}`,
    },
    editable: () => activity.current() === occurrenceId,
    handleDOMEvents: {
      compositionstart: () => {
        clearTimeout(compositionTimer)
        composing = true
        data.current.onSourceCompositionChange(sourceId, true)
        return false
      },
      compositionend: () => {
        clearTimeout(compositionTimer)
        compositionTimer = setTimeout(() => {
          composing = false
          data.current.onSourceCompositionChange(sourceId, false)
        }, 0)
        return false
      },
    },
    dispatchTransaction: (transaction) => {
      const next = nestedView.state.apply(transaction)
      nestedView.updateState(next)
      if (!transaction.docChanged) return
      const converted = snapshotToPageDocument(pmToSnapshot(next.doc, data.current.profile), {
        pageId: source.id,
        version: sourceVersion,
        blocks: [source.section],
      }).blocks[0]
      if (converted?.type !== "section") return
      emitted = JSON.stringify(converted)
      sourceVersion += 1
      data.current.onSourceEdit({ ...source, version: sourceVersion, section: converted })
    },
  })
  const detach = attachBlockInteractions(nestedView, {
    readOnly: false,
    active: () => activity.current() === occurrenceId,
  })
  const activate = () => activity.activate(occurrenceId)
  const deactivate = (event: FocusEvent) => {
    if (event.relatedTarget instanceof Node && dom.contains(event.relatedTarget)) return
    activity.deactivate(occurrenceId)
  }
  dom.addEventListener("pointerdown", activate, true)
  dom.addEventListener("focusout", deactivate, true)
  const refresh = () => {
    const current = data.current.sources.find((candidate) => candidate.id === sourceId)
    if (
      current === undefined ||
      current.version <= sourceVersion ||
      JSON.stringify(current.section) === emitted ||
      nestedView.composing ||
      activity.current() === occurrenceId
    )
      return
    sourceVersion = current.version
    nestedView.updateState(
      createEditorState({
        document: snapshotToPm(
          pageDocumentToSnapshot({
            pageId: current.id,
            version: current.version,
            blocks: [current.section],
          }),
          data.current.profile,
        ),
        readonly: false,
        profile: data.current.profile,
      }),
    )
    label.textContent = `동기화된 섹션 · v${current.version}`
  }
  const destroy = () => {
    dom.removeEventListener("pointerdown", activate, true)
    dom.removeEventListener("focusout", deactivate, true)
    clearTimeout(compositionTimer)
    if (composing) data.current.onSourceCompositionChange(sourceId, false)
    detach()
    nestedView.destroy()
  }
  editors.set(occurrenceId, { view: nestedView, refresh, destroy })
  return {
    dom,
    stopEvent: (event) => event.target instanceof Node && dom.contains(event.target),
    destroy: () => {
      destroy()
      editors.delete(occurrenceId)
    },
  }
}

import type { SourceRuntimeRegistry } from "@block-editor/bindings"
import { pmToSnapshot, snapshotToPm } from "@block-editor/prosemirror"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import type { EditorState } from "prosemirror-state"
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
  readonly runtimes: SourceRuntimeRegistry<EditorState, ProseMirrorNode>
}

export const createSyncedSectionView = ({
  node,
  view,
  getPos,
  data,
  editors,
  activity,
  runtimes,
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
  badge.append(icon, "동기화")
  const label = view.dom.ownerDocument.createElement("span")
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
    const record = data.current.sources.find((candidate) => candidate.content.id === sourceId)
    const source = record?.content
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
  header.append(badge, label, duplicate, unlink)
  const host = view.dom.ownerDocument.createElement("div")
  host.className = "structured-sync__content"
  dom.append(header, host)
  const sourceRecord = data.current.sources.find((candidate) => candidate.content.id === sourceId)
  if (sourceRecord === undefined) {
    label.textContent = `${sourceId} · 원본 없음`
    return { dom }
  }
  const source = sourceRecord.content
  label.textContent = `v${source.version}`
  let sourceVersion = source.version
  let emitted = JSON.stringify(source.section)
  let composing = false
  let compositionTimer: ReturnType<typeof setTimeout> | undefined
  const sourceDocument = snapshotToPm(
    pageDocumentToSnapshot({
      pageId: source.id,
      version: source.version,
      blocks: [source.section],
    }),
    data.current.profile,
  )
  const runtime = runtimes.open(sourceId, {
    state: createEditorState({
      document: sourceDocument,
      readonly: false,
      profile: data.current.profile,
    }),
    revision: sourceRecord.revision,
  })
  const detachOccurrence = runtime.attach(occurrenceId)
  const nestedView = new EditorView(host, {
    state: runtime.state,
    attributes: {
      class: "structured-sync__editor",
      "aria-label": `동기화된 섹션 ${occurrenceId}`,
    },
    editable: () => activity.current() === occurrenceId,
    handleDOMEvents: {
      compositionstart: () => {
        clearTimeout(compositionTimer)
        composing = true
        runtime.setComposing(true)
        data.current.onSourceCompositionChange(sourceId, true)
        return false
      },
      compositionend: () => {
        clearTimeout(compositionTimer)
        compositionTimer = setTimeout(() => {
          composing = false
          runtime.setComposing(false)
          data.current.onSourceCompositionChange(sourceId, false)
        }, 0)
        return false
      },
    },
    dispatchTransaction: (transaction) => {
      if (activity.current() !== occurrenceId) return
      const result = runtime.state.applyTransaction(transaction)
      if (result.transactions.length === 0) return
      if (!result.transactions.some((applied) => applied.docChanged)) {
        runtime.updateState(occurrenceId, result.state)
        return
      }
      runtime.updateLocal(occurrenceId, result.state, crypto.randomUUID())
      const currentSource =
        data.current.sources.find((candidate) => candidate.content.id === sourceId)?.content ??
        source
      const converted = snapshotToPageDocument(
        pmToSnapshot(result.state.doc, data.current.profile),
        {
          pageId: source.id,
          version: currentSource.version,
          blocks: [source.section],
        },
      ).blocks[0]
      if (converted?.type !== "section") return
      emitted = JSON.stringify(converted)
      sourceVersion = Math.max(sourceVersion, currentSource.version) + 1
      data.current.onSourceEdit({ ...currentSource, version: sourceVersion, section: converted })
    },
  })
  const unsubscribe = runtime.subscribe((state) => {
    if (nestedView.state !== state) nestedView.updateState(state)
  })
  const detach = attachBlockInteractions(nestedView, {
    readOnly: false,
    active: () => activity.current() === occurrenceId,
  })
  const activate = () => {
    runtime.activate(occurrenceId)
    activity.activate(occurrenceId)
  }
  const deactivate = (event: FocusEvent) => {
    if (event.relatedTarget instanceof Node && dom.contains(event.relatedTarget)) return
    runtime.deactivate(occurrenceId)
    activity.deactivate(occurrenceId)
  }
  dom.addEventListener("pointerdown", activate, true)
  dom.addEventListener("focusout", deactivate, true)
  const refresh = () => {
    const currentRecord = data.current.sources.find(
      (candidate) => candidate.content.id === sourceId,
    )
    if (currentRecord === undefined || currentRecord.revision <= runtime.baselineRevision) return
    const current = currentRecord.content
    const document = snapshotToPm(
      pageDocumentToSnapshot({
        pageId: current.id,
        version: current.version,
        blocks: [current.section],
      }),
      data.current.profile,
    )
    const pending = runtime.pendingSave()
    if (pending !== null && JSON.stringify(current.section) === emitted) {
      runtime.acknowledge({
        generation: pending.generation,
        causeId: pending.causeId,
        record: { content: document, revision: currentRecord.revision },
      })
      sourceVersion = current.version
      label.textContent = `v${current.version}`
      return
    }
    const result = runtime.receiveRemote({ content: document, revision: currentRecord.revision })
    if (result.kind === "applied") {
      sourceVersion = current.version
      emitted = JSON.stringify(current.section)
      label.textContent = `v${current.version}`
    } else if (result.kind === "conflict") label.textContent = `v${sourceVersion} · 충돌`
  }
  const destroy = () => {
    dom.removeEventListener("pointerdown", activate, true)
    dom.removeEventListener("focusout", deactivate, true)
    clearTimeout(compositionTimer)
    if (composing) data.current.onSourceCompositionChange(sourceId, false)
    runtime.setComposing(false)
    unsubscribe()
    detachOccurrence()
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

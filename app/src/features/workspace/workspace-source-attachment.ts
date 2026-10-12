import type { SourceRuntime } from "@block-editor/bindings"
import {
  InteractionContextArbiter,
  type InteractionContextHandle,
} from "@block-editor/interactions"
import type { ProseMirrorProfile } from "@block-editor/prosemirror"
import type { SyncedSource } from "@block-editor/workspace"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import { type EditorState, Selection, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { attachBlockInteractions } from "../../pm/block-interactions"
import type { EntityRecord } from "./workspace-api"
import type { WorkspaceNodeViewData } from "./workspace-node-view-types"
import { dispatchSourceTransaction } from "./workspace-source-editor-dispatch"
import { renderSourceProjection } from "./workspace-source-projector"

export type SourceDataPointer = { readonly current: WorkspaceNodeViewData }
type Bookmark = { readonly anchor: number; readonly head: number }
export type SourceOccurrence = {
  readonly id: string
  readonly host: HTMLElement
  readonly projection: HTMLElement
  readonly data: SourceDataPointer
  bookmark: Bookmark | null
  composing: boolean
  compositionTimer: ReturnType<typeof setTimeout> | undefined
  renderedDocument: ProseMirrorNode | null
  renderedDepth: number | null
}
export type SourceEntry = {
  readonly runtime: SourceRuntime<EditorState, ProseMirrorNode>
  readonly occurrences: Map<string, SourceOccurrence>
  view: EditorView | null
  detachInteractions: (() => void) | null
  remoteRecord: EntityRecord<SyncedSource> | null
  unsubscribe: (() => void) | null
}
export type SourceAttachment = {
  readonly activate: (event: PointerEvent) => void
  readonly deactivate: (event?: FocusEvent) => void
  readonly refresh: (record: EntityRecord<SyncedSource>) => void
  readonly destroy: () => void
}

export class WorkspaceSourceAttachments {
  private readonly interactionArbiter = new InteractionContextArbiter()

  constructor(
    private readonly profile: ProseMirrorProfile,
    private readonly receive: (entry: SourceEntry, record: EntityRecord<SyncedSource>) => void,
  ) {}

  interactionContext(id: string): InteractionContextHandle {
    return this.interactionArbiter.context(id)
  }

  attach(
    entry: SourceEntry,
    occurrenceId: string,
    host: HTMLElement,
    data: SourceDataPointer,
  ): SourceAttachment {
    const projection = host.ownerDocument.createElement("div")
    projection.className = "structured-sync__editor structured-sync__projection"
    projection.contentEditable = "false"
    projection.dataset["sourceProjection"] = "true"
    projection.dataset["interactionContextBoundary"] = "true"
    projection.setAttribute("aria-label", `동기화된 섹션 ${occurrenceId}`)
    const occurrence: SourceOccurrence = {
      id: occurrenceId,
      host,
      projection,
      data,
      bookmark: null,
      composing: false,
      compositionTimer: undefined,
      renderedDocument: null,
      renderedDepth: null,
    }
    entry.occurrences.set(occurrenceId, occurrence)
    const detachRuntime = entry.runtime.attach(occurrenceId)
    host.append(projection)
    this.render(entry, occurrence)
    return {
      activate: (event) => this.activate(entry, occurrence, event),
      deactivate: (event) => this.deactivate(entry, occurrence, event),
      refresh: (record) => {
        this.receive(entry, record)
        this.render(entry, occurrence)
      },
      destroy: () => {
        this.stopComposition(entry, occurrence)
        this.deactivate(entry, occurrence)
        entry.occurrences.delete(occurrenceId)
        detachRuntime()
        projection.remove()
      },
    }
  }

  render(entry: SourceEntry, occurrence: SourceOccurrence): void {
    const document = entry.runtime.state.doc
    const depth = occurrence.data.current.embeddingDepth
    if (occurrence.renderedDocument === document && occurrence.renderedDepth === depth) return
    renderSourceProjection(entry.runtime.state, occurrence.projection, depth)
    occurrence.renderedDocument = document
    occurrence.renderedDepth = depth
  }

  dispose(entry: SourceEntry): void {
    entry.detachInteractions?.()
    entry.view?.destroy()
    entry.detachInteractions = null
    entry.view = null
  }

  private activate(entry: SourceEntry, occurrence: SourceOccurrence, event: PointerEvent): void {
    const previousId = entry.runtime.activeOccurrenceId
    if (previousId !== null && previousId !== occurrence.id) {
      const previous = entry.occurrences.get(previousId)
      if (previous !== undefined) this.deactivate(entry, previous)
    }
    entry.runtime.activate(occurrence.id)
    this.context(entry, occurrence.id).claim()
    if (entry.view === null) this.createView(entry, occurrence)
    const view = entry.view
    if (view === null) return
    occurrence.projection.remove()
    occurrence.host.append(view.dom)
    view.updateRoot()
    if (occurrence.bookmark !== null) {
      const maximum = entry.runtime.state.doc.content.size
      entry.runtime.updateState(
        occurrence.id,
        entry.runtime.state.apply(
          entry.runtime.state.tr.setSelection(
            TextSelection.between(
              entry.runtime.state.doc.resolve(Math.min(occurrence.bookmark.anchor, maximum)),
              entry.runtime.state.doc.resolve(Math.min(occurrence.bookmark.head, maximum)),
            ),
          ),
        ),
      )
    }
    const position = view.posAtCoords({ left: event.clientX, top: event.clientY })
    if (position !== null)
      view.dispatch(
        view.state.tr.setSelection(Selection.near(view.state.doc.resolve(position.pos))),
      )
    event.preventDefault()
    view.focus()
    view.setProps({})
  }

  private deactivate(entry: SourceEntry, occurrence: SourceOccurrence, event?: FocusEvent): void {
    if (
      event?.relatedTarget instanceof Node &&
      occurrence.host.parentElement?.contains(event.relatedTarget)
    )
      return
    if (entry.runtime.activeOccurrenceId !== occurrence.id) return
    const view = entry.view
    if (view !== null)
      occurrence.bookmark = { anchor: view.state.selection.anchor, head: view.state.selection.head }
    this.stopComposition(entry, occurrence)
    entry.runtime.deactivate(occurrence.id)
    this.context(entry, occurrence.id).release()
    view?.dom.remove()
    occurrence.host.append(occurrence.projection)
    this.render(entry, occurrence)
  }

  private createView(entry: SourceEntry, occurrence: SourceOccurrence): void {
    const view = new EditorView(null, {
      state: entry.runtime.state,
      attributes: {
        class: "structured-sync__editor",
        "aria-label": `동기화된 섹션 ${occurrence.id}`,
      },
      editable: () => entry.runtime.activeOccurrenceId !== null,
      handleDOMEvents: {
        compositionstart: () => this.composition(entry, true),
        compositionend: () => this.endComposition(entry),
      },
      dispatchTransaction: (transaction) => {
        const occurrence = this.active(entry)
        if (occurrence !== null)
          dispatchSourceTransaction(entry, occurrence, this.profile, transaction)
      },
    })
    entry.view = view
    entry.detachInteractions = attachBlockInteractions(view, {
      readOnly: false,
      isActive: () => {
        const active = entry.runtime.activeOccurrenceId
        return active !== null && this.context(entry, active).isActive()
      },
      claim: () => {
        const active = entry.runtime.activeOccurrenceId
        if (active !== null) this.context(entry, active).claim()
      },
      release: () => {
        const active = entry.runtime.activeOccurrenceId
        if (active !== null) this.context(entry, active).release()
      },
      subscribeActive: (listener) =>
        this.interactionArbiter.subscribe(() => {
          const active = entry.runtime.activeOccurrenceId
          listener(active !== null && this.context(entry, active).isActive())
        }),
    })
  }

  private composition(entry: SourceEntry, active: boolean): false {
    const occurrence = this.active(entry)
    if (occurrence === null) return false
    clearTimeout(occurrence.compositionTimer)
    occurrence.composing = active
    entry.runtime.setComposing(occurrence.id, active)
    occurrence.data.current.onSourceCompositionChange(entry.runtime.sourceId, active)
    return false
  }

  private endComposition(entry: SourceEntry): false {
    const occurrence = this.active(entry)
    if (occurrence === null) return false
    clearTimeout(occurrence.compositionTimer)
    occurrence.compositionTimer = setTimeout(() => this.stopComposition(entry, occurrence), 0)
    return false
  }

  private stopComposition(entry: SourceEntry, occurrence: SourceOccurrence): void {
    clearTimeout(occurrence.compositionTimer)
    occurrence.compositionTimer = undefined
    entry.runtime.setComposing(occurrence.id, false)
    if (!occurrence.composing) return
    occurrence.composing = false
    occurrence.data.current.onSourceCompositionChange(entry.runtime.sourceId, false)
  }

  private active(entry: SourceEntry): SourceOccurrence | null {
    const id = entry.runtime.activeOccurrenceId
    return id === null ? null : (entry.occurrences.get(id) ?? null)
  }

  private context(entry: SourceEntry, occurrenceId: string): InteractionContextHandle {
    return this.interactionContext(`source:${entry.runtime.sourceId}:${occurrenceId}`)
  }
}

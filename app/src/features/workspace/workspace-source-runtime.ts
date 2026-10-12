import { type SourceConflictResolution, SourceRuntimeRegistry } from "@block-editor/bindings"
import type { InteractionContextHandle } from "@block-editor/interactions"
import { snapshotToPm } from "@block-editor/prosemirror"
import type { SyncedSource } from "@block-editor/workspace"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import type { EditorState } from "prosemirror-state"
import { createEditorState } from "../../pm/editor"
import type { EntityRecord } from "./workspace-api"
import { createWorkspaceProfile, pageDocumentToSnapshot } from "./workspace-editor-model"
import type { SourceEditRequest } from "./workspace-node-view-types"
import {
  type SourceAttachment,
  type SourceDataPointer,
  type SourceEntry,
  WorkspaceSourceAttachments,
} from "./workspace-source-attachment"

export type { SourceAttachment } from "./workspace-source-attachment"

export type SourceConflictResult =
  | {
      readonly kind: "accept-remote"
      readonly record: EntityRecord<SyncedSource>
    }
  | {
      readonly kind: "keep-local"
      readonly record: EntityRecord<SyncedSource>
      readonly generation: number
      readonly causeId: string
      readonly baselineRevision: number
    }

export class WorkspaceSourceRuntime {
  readonly profile = createWorkspaceProfile(0)
  private readonly registry = new SourceRuntimeRegistry<EditorState, ProseMirrorNode>({
    contentOf: (state) => state.doc,
    contentEquals: (left, right) => left.eq(right),
    replaceContent: (state, document) =>
      state.apply(
        state.tr
          .replaceWith(0, state.doc.content.size, document.content)
          .setMeta("addToHistory", false)
          .setMeta("origin", "remote"),
      ),
  })
  private readonly entries = new Map<string, SourceEntry>()
  private readonly statusListeners = new Map<string, Set<() => void>>()
  private readonly evictionTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly attachments = new WorkspaceSourceAttachments(this.profile, (entry, record) =>
    this.receive(entry, record),
  )

  interactionContext(id: string): InteractionContextHandle {
    return this.attachments.interactionContext(id)
  }

  attach(
    sourceRecord: EntityRecord<SyncedSource>,
    occurrenceId: string,
    host: HTMLElement,
    data: SourceDataPointer,
  ): SourceAttachment {
    clearTimeout(this.evictionTimers.get(sourceRecord.documentId))
    this.evictionTimers.delete(sourceRecord.documentId)
    const entry = this.entry(sourceRecord)
    this.subscribeEntry(entry)
    const attachment = this.attachments.attach(entry, occurrenceId, host, data)
    return {
      ...attachment,
      destroy: () => {
        attachment.destroy()
        if (entry.occurrences.size > 0) return
        this.park(entry)
        this.scheduleEviction(entry)
      },
    }
  }

  acknowledge(request: SourceEditRequest, record: EntityRecord<SyncedSource>): void {
    const entry = this.entries.get(request.sourceId)
    if (entry === undefined) return
    const result = entry.runtime.acknowledge({
      generation: request.generation,
      causeId: request.causeId,
      record: { revision: record.revision, content: this.documentOf(record.content) },
    })
    if (
      result.kind === "accepted" &&
      entry.remoteRecord !== null &&
      entry.remoteRecord.revision <= record.revision
    )
      entry.remoteRecord = null
    this.emitStatus(request.sourceId)
    if (entry.occurrences.size === 0) this.scheduleEviction(entry)
  }

  receiveRemote(record: EntityRecord<SyncedSource>): void {
    const entry = this.entries.get(record.documentId)
    if (entry !== undefined) this.receive(entry, record)
  }

  resolve(sourceId: string, resolution: SourceConflictResolution): SourceConflictResult | null {
    const entry = this.entries.get(sourceId)
    if (entry === undefined || entry.remoteRecord === null) return null
    const record = entry.remoteRecord
    entry.runtime.resolveConflict(resolution)
    entry.remoteRecord = null
    this.emitStatus(sourceId)
    if (entry.occurrences.size === 0) this.scheduleEviction(entry)
    if (resolution === "accept-remote") return { kind: resolution, record }
    const pending = entry.runtime.pendingSave()
    return pending === null
      ? null
      : {
          kind: resolution,
          record,
          generation: pending.generation,
          causeId: pending.causeId,
          baselineRevision: pending.baselineRevision,
        }
  }

  conflict(sourceId: string): EntityRecord<SyncedSource> | null {
    return this.entries.get(sourceId)?.remoteRecord ?? null
  }

  subscribe(sourceId: string, listener: () => void): () => void {
    const listeners = this.statusListeners.get(sourceId) ?? new Set<() => void>()
    listeners.add(listener)
    this.statusListeners.set(sourceId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.statusListeners.delete(sourceId)
    }
  }

  dispose(): void {
    for (const timer of this.evictionTimers.values()) clearTimeout(timer)
    for (const entry of this.entries.values()) {
      entry.unsubscribe?.()
      this.attachments.dispose(entry)
    }
    this.entries.clear()
    this.evictionTimers.clear()
    this.statusListeners.clear()
    this.registry.clear()
  }

  private open(sourceRecord: EntityRecord<SyncedSource>) {
    return this.registry.open(sourceRecord.documentId, {
      state: createEditorState({
        document: this.documentOf(sourceRecord.content),
        readonly: false,
        profile: this.profile,
      }),
      revision: sourceRecord.revision,
    })
  }

  private entry(sourceRecord: EntityRecord<SyncedSource>): SourceEntry {
    const existing = this.entries.get(sourceRecord.documentId)
    if (existing !== undefined) return existing
    const runtime = this.open(sourceRecord)
    const entry: SourceEntry = {
      runtime,
      occurrences: new Map(),
      view: null,
      detachInteractions: null,
      remoteRecord: null,
      unsubscribe: null,
    }
    this.subscribeEntry(entry)
    this.entries.set(sourceRecord.documentId, entry)
    return entry
  }

  private subscribeEntry(entry: SourceEntry): void {
    if (entry.unsubscribe !== null) return
    entry.unsubscribe = entry.runtime.subscribe((state) => {
      if (entry.view !== null && entry.view.state !== state) entry.view.updateState(state)
      for (const occurrence of entry.occurrences.values())
        if (entry.runtime.activeOccurrenceId !== occurrence.id)
          this.attachments.render(entry, occurrence)
    })
  }

  private park(entry: SourceEntry): void {
    entry.unsubscribe?.()
    entry.unsubscribe = null
    this.attachments.dispose(entry)
  }

  private scheduleEviction(entry: SourceEntry): void {
    const sourceId = entry.runtime.sourceId
    clearTimeout(this.evictionTimers.get(sourceId))
    this.evictionTimers.delete(sourceId)
    if (entry.runtime.dirty || entry.remoteRecord !== null) return
    const timer = setTimeout(() => this.evict(sourceId, entry), 30_000)
    this.evictionTimers.set(sourceId, timer)
  }

  private documentOf(source: SyncedSource): ProseMirrorNode {
    return snapshotToPm(
      pageDocumentToSnapshot({
        pageId: source.id,
        version: source.version,
        blocks: [source.section],
      }),
      this.profile,
    )
  }

  private receive(entry: SourceEntry, record: EntityRecord<SyncedSource>): void {
    const result = entry.runtime.receiveRemote({
      revision: record.revision,
      content: this.documentOf(record.content),
    })
    if (result.kind === "conflict") entry.remoteRecord = record
    else if (result.kind === "applied") entry.remoteRecord = null
    if (result.kind !== "ignored") this.emitStatus(entry.runtime.sourceId)
  }

  private evict(sourceId: string, entry: SourceEntry): void {
    this.evictionTimers.delete(sourceId)
    if (entry.occurrences.size > 0 || entry.runtime.dirty || entry.remoteRecord !== null) return
    entry.unsubscribe?.()
    this.attachments.dispose(entry)
    this.entries.delete(sourceId)
    this.registry.release(sourceId, entry.runtime)
  }

  private emitStatus(sourceId: string): void {
    for (const listener of this.statusListeners.get(sourceId) ?? []) listener()
  }
}

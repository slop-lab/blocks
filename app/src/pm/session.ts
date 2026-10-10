import type { Node as ProseMirrorNode } from "prosemirror-model"
import type { EditorState, Transaction } from "prosemirror-state"
import { decodeDocument } from "../core/codec"
import type { BlockDocument, ChangeEvent } from "../core/types"
import { changeEventFrom, createEditorState } from "./editor"
import { pmToSnapshot, snapshotToPm } from "./snapshot"

export type SessionOptions = {
  readonly modelId: string
  readonly document: BlockDocument
  readonly epoch: number
  readonly version: number
  readonly readOnly: boolean
}
export type Bookmark = {
  readonly modelId: string
  readonly epoch: number
  readonly baseVersion: number
  readonly blockId: string
  readonly offset: number
  readonly affinity: -1 | 1
}
export type ExternalContent = {
  readonly modelId: string
  readonly epoch: number
  readonly baseVersion: number
  readonly requestId: string
  readonly document: BlockDocument
}
export type ExternalResult =
  | { readonly kind: "applied"; readonly historyReset: true }
  | { readonly kind: "deferred" }
  | { readonly kind: "conflict"; readonly reason: string }

const changedIds = (before: ProseMirrorNode, after: ProseMirrorNode) => {
  const revisions = (node: ProseMirrorNode) => {
    const entries = new Map<string, { readonly block: ProseMirrorNode; readonly index: number }>()
    node.forEach((block, _position, index) => {
      const id = block.attrs["id"]
      if (typeof id === "string") entries.set(id, { block, index })
    })
    return entries
  }
  const old = revisions(before)
  const next = revisions(after)
  return [...new Set([...old.keys(), ...next.keys()])].filter((id) => {
    const previous = old.get(id)
    const current = next.get(id)
    return (
      previous === undefined ||
      current === undefined ||
      previous.index !== current.index ||
      !previous.block.eq(current.block)
    )
  })
}

/** ProseMirror is the only mutable content owner. Snapshots are derived reads. */
export class ModelSession {
  private current: EditorState
  private revision: number
  private generation: number
  private disposed = false
  private composing = false
  private pending: ExternalContent | null = null
  private readonly listeners = new Set<(event: ChangeEvent | null) => void>()
  private readonly appliedRequests = new Set<string>()
  private mountOwner: symbol | null = null

  constructor(readonly options: SessionOptions) {
    this.current = createEditorState({
      document: snapshotToPm(decodeDocument(options.document)),
      readonly: options.readOnly,
    })
    this.revision = options.version
    this.generation = options.epoch
  }
  get state() {
    return this.current
  }
  get version() {
    return this.revision
  }
  get epoch() {
    return this.generation
  }
  get snapshot() {
    return pmToSnapshot(this.current.doc)
  }
  get isComposing() {
    return this.composing
  }
  get deferredContent() {
    return this.pending
  }

  attach() {
    if (this.disposed || this.mountOwner !== null) return null
    const owner = Symbol("surface")
    this.mountOwner = owner
    return () => {
      if (this.mountOwner === owner) this.mountOwner = null
    }
  }
  subscribe(listener: (event: ChangeEvent | null) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  dispatch(transaction: Transaction) {
    if (this.disposed || (this.options.readOnly && transaction.docChanged)) return false
    const before = this.current
    const result = before.applyTransaction(transaction)
    this.current = result.state
    if (result.transactions.length === 0) return false
    let event: ChangeEvent | null = null
    if (!before.doc.eq(this.current.doc)) {
      event = {
        ...changeEventFrom(transaction, this.revision, this.generation),
        modelId: this.options.modelId,
        beforeVersion: this.revision,
        version: this.revision + 1,
        changedBlockIds: changedIds(before.doc, this.current.doc),
        patch: {
          adapterId: "prosemirror",
          adapterVersion: "1",
          opaque: result.transactions.flatMap((item) => item.steps),
        },
      }
      this.revision = event.version
    }
    for (const listener of this.listeners) listener(event)
    return true
  }
  setComposing(value: boolean) {
    this.composing = value
  }
  applyExternal(update: ExternalContent): ExternalResult {
    if (this.disposed || update.modelId !== this.options.modelId || update.epoch !== this.epoch)
      return { kind: "conflict", reason: "Model identity or session epoch changed" }
    if (this.appliedRequests.has(update.requestId))
      return { kind: "conflict", reason: "Request already applied" }
    if (update.baseVersion !== this.version)
      return { kind: "conflict", reason: "Local edits changed the update base; draft preserved" }
    if (this.composing) {
      this.pending = update
      return { kind: "deferred" }
    }
    const before = this.current.doc
    this.current = createEditorState({
      document: snapshotToPm(decodeDocument(update.document)),
      readonly: this.options.readOnly,
    })
    this.revision += 1
    this.pending = null
    this.appliedRequests.add(update.requestId)
    const event: ChangeEvent = {
      origin: "host",
      version: this.version,
      epoch: this.epoch,
      changeId: crypto.randomUUID(),
      historyGroup: null,
      modelId: this.options.modelId,
      beforeVersion: this.version - 1,
      causeId: update.requestId,
      changedBlockIds: changedIds(before, this.current.doc),
    }
    for (const listener of this.listeners) listener(event)
    return { kind: "applied", historyReset: true }
  }
  flushExternal(): ExternalResult | null {
    const update = this.pending
    this.pending = null
    return update === null ? null : this.applyExternal(update)
  }
  bookmark(blockId: string, offset = 0): Bookmark {
    return {
      modelId: this.options.modelId,
      epoch: this.epoch,
      baseVersion: this.version,
      blockId,
      offset,
      affinity: 1,
    }
  }
  resolve(bookmark: Bookmark) {
    if (this.disposed || bookmark.modelId !== this.options.modelId || bookmark.epoch !== this.epoch)
      return { kind: "missing" as const }
    const matches = this.snapshot.blocks.filter((block) => block.id === bookmark.blockId)
    if (matches.length > 1) return { kind: "ambiguous" as const }
    if (matches.length === 0) return { kind: "missing" as const }
    const block = matches[0]
    const length =
      block?.content.reduce(
        (total, inline) => total + (inline.kind === "text" ? inline.text.length : 0),
        0,
      ) ?? 0
    if (!Number.isInteger(bookmark.offset) || bookmark.offset < 0 || bookmark.offset > length)
      return { kind: "missing" as const }
    // Block bookmarks remain resolvable; stale text offsets are never guessed.
    if (bookmark.baseVersion !== this.version && bookmark.offset !== 0)
      return { kind: "partial" as const, blockId: bookmark.blockId }
    return {
      kind: bookmark.baseVersion === this.version ? ("exact" as const) : ("mapped" as const),
      blockId: bookmark.blockId,
      offset: bookmark.offset,
    }
  }
  dispose() {
    this.disposed = true
    this.mountOwner = null
    this.pending = null
    this.listeners.clear()
  }
}

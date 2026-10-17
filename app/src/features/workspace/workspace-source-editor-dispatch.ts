import { type ProseMirrorProfile, pmToSnapshot } from "@slop-lab/blocks-prosemirror"
import type { Transaction } from "prosemirror-state"
import { snapshotToPageDocument } from "./workspace-editor-model"
import type { SourceEntry, SourceOccurrence } from "./workspace-source-attachment"

export const dispatchSourceTransaction = (
  entry: SourceEntry,
  occurrence: SourceOccurrence,
  input: {
    readonly profile: ProseMirrorProfile
    readonly transaction: Transaction
  },
): void => {
  const result = entry.runtime.state.applyTransaction(input.transaction)
  if (result.transactions.length === 0) return
  occurrence.bookmark = {
    anchor: result.state.selection.anchor,
    head: result.state.selection.head,
  }
  if (!result.transactions.some((applied) => applied.docChanged)) {
    entry.runtime.updateState(occurrence.id, result.state)
    return
  }
  entry.runtime.updateLocal(occurrence.id, result.state, crypto.randomUUID())
  const record = occurrence.data.current.sources.find(
    (candidate) => candidate.documentId === entry.runtime.sourceId,
  )
  if (record === undefined) return
  const converted = snapshotToPageDocument(pmToSnapshot(result.state.doc, input.profile), {
    pageId: record.content.id,
    version: record.content.version,
    blocks: [record.content.section],
  }).blocks[0]
  const pending = entry.runtime.pendingSave()
  if (converted?.type !== "section" || pending === null) return
  occurrence.data.current.onSourceEdit({
    sourceId: entry.runtime.sourceId,
    baselineRevision: pending.baselineRevision,
    generation: pending.generation,
    causeId: pending.causeId,
    content: { ...record.content, version: record.content.version + 1, section: converted },
  })
}

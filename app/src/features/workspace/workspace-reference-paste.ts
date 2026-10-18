import type { ClipboardEnvelope } from "@slop-lab/blocks-interactions"
import type { ReferencePasteContext } from "@slop-lab/blocks-interactions/prosemirror"
import type { SyncedSource } from "@slop-lab/blocks-workspace"
import { Fragment } from "prosemirror-model"
import type { EntityRecord } from "./workspace-api"

export const pasteWorkspaceReferences = (
  envelope: ClipboardEnvelope,
  context: ReferencePasteContext,
  sources: readonly EntityRecord<SyncedSource>[],
): void => {
  const sourceIds = [...new Set(envelope.externalReferences)]
  const section = context.view.state.schema.nodes["section"]
  if (section === undefined || sourceIds.length === 0) return
  const references = sourceIds.flatMap((sourceId) =>
    sources.some((record) => record.content.id === sourceId)
      ? [
          section.create({
            id: crypto.randomUUID(),
            locked: false,
            occurrenceId: crypto.randomUUID(),
            sourceId,
          }),
        ]
      : [],
  )
  if (references.length === 0) return
  context.view.dispatch(
    context.view.state.tr
      .insert(context.insertion, Fragment.fromArray(references))
      .setMeta("origin", "paste")
      .scrollIntoView(),
  )
}

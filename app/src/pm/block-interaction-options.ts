import type { ClipboardEnvelope, ClipboardPolicy } from "@block-editor/interactions"
import type { ReferencePasteContext } from "@block-editor/interactions/prosemirror"

export type BlockInteractionOptions = {
  readonly readOnly: boolean
  readonly active?: () => boolean
  readonly onUnavailable?: (message: string) => void
  readonly clipboardPolicy?: ClipboardPolicy
  readonly onDeferredCut?: (
    blockIds: readonly string[],
    envelope: ClipboardEnvelope,
  ) => void | Promise<void>
  readonly onReferencePaste?: (envelope: ClipboardEnvelope, context: ReferencePasteContext) => void
}

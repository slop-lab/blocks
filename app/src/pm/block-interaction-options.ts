import type {
  ClipboardEnvelope,
  ClipboardPolicy,
  InteractionContextArbiter,
} from "@block-editor/interactions"
import type {
  ClipboardInteractionContext,
  ReferencePasteContext,
} from "@block-editor/interactions/prosemirror"

export const defaultBlockClipboardPolicy = {
  namespace: "block-editor/default",
  cut: "remove-after-write",
  paste: () => "clone",
} satisfies ClipboardPolicy

export type BlockInteractionOptions = {
  readonly readOnly: boolean
  readonly scope?: InteractionContextArbiter
  readonly contextId?: string
  readonly isActive?: () => boolean
  readonly claim?: () => void
  readonly release?: () => void
  readonly subscribeActive?: (listener: (active: boolean) => void) => () => void
  readonly onUnavailable?: (message: string) => void
  readonly clipboardPolicy?: ClipboardPolicy
  readonly interactionContext?: () => ClipboardInteractionContext
  readonly onDeferredCut?: (
    blockIds: readonly string[],
    envelope: ClipboardEnvelope,
    context: ClipboardInteractionContext | null,
  ) => void | Promise<void>
  readonly onReferencePaste?: (envelope: ClipboardEnvelope, context: ReferencePasteContext) => void
}

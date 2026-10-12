import { z } from "zod"

export {
  InteractionContextArbiter,
  type InteractionContextHandle,
  type InteractionContextSnapshot,
} from "./context.js"
export { type CutPolicy, type CutRoute, type CutRouteOptions, routeCut } from "./cut.js"
export { ContentHistory, type HistorySnapshot } from "./history.js"

import {
  flatSelectionScope,
  initialBlockSelectionState,
  reconcileBlockSelection,
  reduceBlockSelection,
  type SelectionIntent,
} from "./selection.js"

export {
  type BlockSelectionScope,
  type BlockSelectionState,
  initialBlockSelectionState,
  reconcileBlockSelection,
  reduceBlockSelection,
  type SelectionIntent,
  selectionStateForIds,
} from "./selection.js"

export const BLOCK_CLIPBOARD_MIME = "application/x-block-editor+json" as const

export class BlockSelection {
  private state = initialBlockSelectionState

  get value(): readonly string[] {
    return this.state.selectedIds
  }

  get anchor(): string | null {
    return this.state.anchorId
  }

  get focus(): string | null {
    return this.state.focusId
  }

  reconcile(visible: readonly string[]): void {
    this.state = reconcileBlockSelection(this.state, flatSelectionScope(visible))
  }

  apply(intent: SelectionIntent, visible: readonly string[]): void {
    this.state = reduceBlockSelection(this.state, intent, flatSelectionScope(visible))
  }
}

export type ClipboardEnvelope<T = unknown> = {
  readonly namespace: string
  readonly blocks: readonly T[]
  readonly externalReferences: readonly string[]
}

export type PasteDecision = "clone" | "link" | "reject"
export type ClipboardPolicy<T = unknown> = {
  readonly namespace: string
  readonly cut: import("./cut.js").CutPolicy
  readonly paste: (
    envelope: ClipboardEnvelope<T>,
    context: { readonly external: boolean },
  ) => PasteDecision
}

export type EncodedBlockClipboard = {
  readonly mime: typeof BLOCK_CLIPBOARD_MIME
  readonly json: string
  readonly text: string
  readonly html?: never
}

const clipboardSchema = z
  .object({
    version: z.literal(1),
    namespace: z.string().min(1).max(160),
    blocks: z.array(z.unknown()).max(10_000),
    externalReferences: z.array(z.string().max(500)).max(10_000),
  })
  .strict()

export const encodeBlockClipboard = <T>(
  envelope: ClipboardEnvelope<T>,
  plaintext: (blocks: readonly T[]) => string,
): EncodedBlockClipboard => ({
  mime: BLOCK_CLIPBOARD_MIME,
  json: JSON.stringify({ version: 1, ...envelope }),
  text: plaintext(envelope.blocks),
})

export type DecodedBlockClipboard =
  | { readonly kind: "valid"; readonly envelope: ClipboardEnvelope }
  | {
      readonly kind: "invalid"
      readonly reason: "malformed-json" | "unsupported-version" | "invalid-shape"
    }

export const decodeBlockClipboard = (input: string): DecodedBlockClipboard => {
  let raw: unknown
  try {
    raw = JSON.parse(input)
  } catch (error) {
    if (error instanceof SyntaxError) return { kind: "invalid", reason: "malformed-json" }
    throw error
  }
  if (typeof raw === "object" && raw !== null && "version" in raw && raw.version !== 1)
    return { kind: "invalid", reason: "unsupported-version" }
  const parsed = clipboardSchema.safeParse(raw)
  if (!parsed.success) return { kind: "invalid", reason: "invalid-shape" }
  return {
    kind: "valid",
    envelope: {
      namespace: parsed.data.namespace,
      blocks: parsed.data.blocks,
      externalReferences: parsed.data.externalReferences,
    },
  }
}

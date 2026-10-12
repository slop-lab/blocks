import { z } from "zod"

export { type CutPolicy, type CutRoute, type CutRouteOptions, routeCut } from "./cut.js"
export { ContentHistory, type HistorySnapshot } from "./history.js"

export const BLOCK_CLIPBOARD_MIME = "application/x-block-editor+json" as const

export type SelectionIntent =
  | { readonly kind: "replace"; readonly id: string }
  | { readonly kind: "range"; readonly id: string }
  | { readonly kind: "toggle"; readonly id: string }
  | { readonly kind: "clear" }

export class BlockSelection {
  private selected: readonly string[] = []
  private anchorId: string | null = null
  private focusId: string | null = null

  get value(): readonly string[] {
    return this.selected
  }

  get anchor(): string | null {
    return this.anchorId
  }

  get focus(): string | null {
    return this.focusId
  }

  reconcile(visible: readonly string[]): void {
    const available = new Set(visible)
    this.selected = visible.filter((id) => this.selected.includes(id))
    if (this.anchorId !== null && !available.has(this.anchorId)) this.anchorId = null
    if (this.focusId !== null && !available.has(this.focusId)) this.focusId = null
  }

  apply(intent: SelectionIntent, visible: readonly string[]): void {
    switch (intent.kind) {
      case "clear":
        this.selected = []
        this.anchorId = null
        this.focusId = null
        return
      case "replace":
        this.selected = visible.includes(intent.id) ? [intent.id] : []
        this.anchorId = intent.id
        this.focusId = intent.id
        return
      case "toggle": {
        if (!visible.includes(intent.id)) return
        const current = new Set(this.selected)
        if (current.has(intent.id)) current.delete(intent.id)
        else current.add(intent.id)
        this.selected = visible.filter((id) => current.has(id))
        this.anchorId ??= intent.id
        this.focusId = intent.id
        return
      }
      case "range": {
        const previousFocus = this.focusId === null ? -1 : visible.indexOf(this.focusId)
        const focus = visible.indexOf(intent.id)
        if (focus < 0) return
        const start = previousFocus < 0 ? focus : Math.min(previousFocus, focus)
        const end = previousFocus < 0 ? focus : Math.max(previousFocus, focus)
        const current = new Set(this.selected)
        const remove = current.has(intent.id)
        for (const id of visible.slice(start, end + 1)) {
          if (remove) current.delete(id)
          else current.add(id)
        }
        this.selected = visible.filter((id) => current.has(id))
        this.anchorId ??= intent.id
        this.focusId = intent.id
        return
      }
      default:
        intent satisfies never
        return
    }
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

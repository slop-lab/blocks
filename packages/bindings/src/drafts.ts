export type BindingEntry = {
  readonly blockId: string
  readonly version: number
  readonly draft: string
  readonly dirty: boolean
}

export type BindingState = { readonly entries: Readonly<Record<string, BindingEntry>> }
export type BindingBookmark = { readonly blockId: string; readonly version: number }

export const createBindingState = (entries: readonly BindingEntry[]): BindingState => ({
  entries: Object.fromEntries(entries.map((entry) => [entry.blockId, entry])),
})

export const resolveBinding = (
  state: BindingState,
  bookmark: BindingBookmark,
  value: string,
):
  | { readonly kind: "stale"; readonly state: BindingState }
  | { readonly kind: "applied"; readonly state: BindingState } => {
  const current = state.entries[bookmark.blockId]
  if (current === undefined || current.version !== bookmark.version) return { kind: "stale", state }
  return {
    kind: "applied",
    state: {
      entries: {
        ...state.entries,
        [bookmark.blockId]: { ...current, draft: value, dirty: false },
      },
    },
  }
}

type SaveAcknowledgementInput = Readonly<{
  mounted: boolean
  latestRequest: boolean
  requestTargetId: string
  currentTargetId: string
  submittedDraft: string
  currentDraft: string
}>

export type SaveAcknowledgement = "close" | "preserve" | "stale"

export const resolveSaveAcknowledgement = (
  input: SaveAcknowledgementInput,
): SaveAcknowledgement => {
  if (!input.mounted || !input.latestRequest || input.requestTargetId !== input.currentTargetId)
    return "stale"
  return input.submittedDraft === input.currentDraft ? "close" : "preserve"
}

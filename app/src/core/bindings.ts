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

export const resolveBinding = (state: BindingState, bookmark: BindingBookmark, value: string) => {
  const current = state.entries[bookmark.blockId]
  if (current === undefined || current.version !== bookmark.version)
    return { kind: "stale" as const, state }
  return {
    kind: "applied" as const,
    state: {
      entries: {
        ...state.entries,
        [bookmark.blockId]: { ...current, draft: value, dirty: false },
      },
    },
  }
}

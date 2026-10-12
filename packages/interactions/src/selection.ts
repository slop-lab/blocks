export type SelectionIntent =
  | { readonly kind: "replace"; readonly id: string }
  | { readonly kind: "range"; readonly id: string }
  | { readonly kind: "toggle"; readonly id: string }
  | { readonly kind: "clear" }

export type BlockSelectionState = {
  readonly selectedIds: readonly string[]
  readonly anchorId: string | null
  readonly focusId: string | null
}

export type BlockSelectionScope = {
  readonly visibleIds: readonly string[]
  readonly parentById: ReadonlyMap<string, string | null>
}

export const initialBlockSelectionState: BlockSelectionState = {
  selectedIds: [],
  anchorId: null,
  focusId: null,
}

const ancestorsOf = (id: string, scope: BlockSelectionScope): ReadonlySet<string> => {
  const ancestors = new Set<string>()
  let current = scope.parentById.get(id) ?? null
  while (current !== null && !ancestors.has(current)) {
    ancestors.add(current)
    current = scope.parentById.get(current) ?? null
  }
  return ancestors
}

const canonicalIds = (
  requested: ReadonlySet<string>,
  scope: BlockSelectionScope,
): readonly string[] =>
  scope.visibleIds.filter((id) => {
    if (!requested.has(id)) return false
    for (const ancestor of ancestorsOf(id, scope)) if (requested.has(ancestor)) return false
    return true
  })

const toggleRoot = (
  selectedIds: readonly string[],
  id: string,
  scope: BlockSelectionScope,
): readonly string[] => {
  if (!scope.visibleIds.includes(id)) return selectedIds
  const selected = new Set(selectedIds)
  if (selected.has(id)) selected.delete(id)
  else {
    const targetAncestors = ancestorsOf(id, scope)
    for (const selectedId of selected) {
      if (targetAncestors.has(selectedId) || ancestorsOf(selectedId, scope).has(id))
        selected.delete(selectedId)
    }
    selected.add(id)
  }
  return canonicalIds(selected, scope)
}

export const selectionStateForIds = (
  ids: readonly string[],
  scope: BlockSelectionScope,
): BlockSelectionState => {
  const selectedIds = canonicalIds(new Set(ids), scope)
  const focusId = selectedIds.at(-1) ?? null
  return { selectedIds, anchorId: selectedIds[0] ?? null, focusId }
}

export const reconcileBlockSelection = (
  state: BlockSelectionState,
  scope: BlockSelectionScope,
): BlockSelectionState => {
  const available = new Set(scope.visibleIds)
  return {
    selectedIds: canonicalIds(new Set(state.selectedIds), scope),
    anchorId: state.anchorId !== null && available.has(state.anchorId) ? state.anchorId : null,
    focusId: state.focusId !== null && available.has(state.focusId) ? state.focusId : null,
  }
}

export const reduceBlockSelection = (
  state: BlockSelectionState,
  intent: SelectionIntent,
  scope: BlockSelectionScope,
): BlockSelectionState => {
  switch (intent.kind) {
    case "clear":
      return initialBlockSelectionState
    case "replace":
      return scope.visibleIds.includes(intent.id)
        ? { selectedIds: [intent.id], anchorId: intent.id, focusId: intent.id }
        : initialBlockSelectionState
    case "toggle":
      return {
        selectedIds: toggleRoot(state.selectedIds, intent.id, scope),
        anchorId: state.anchorId ?? intent.id,
        focusId: intent.id,
      }
    case "range": {
      const focusIndex = scope.visibleIds.indexOf(intent.id)
      if (focusIndex < 0) return state
      const previousIndex = state.focusId === null ? -1 : scope.visibleIds.indexOf(state.focusId)
      const start = previousIndex < 0 ? focusIndex : Math.min(previousIndex, focusIndex)
      const end = previousIndex < 0 ? focusIndex : Math.max(previousIndex, focusIndex)
      const selected = new Set(state.selectedIds)
      const remove = selected.has(intent.id)
      for (const id of scope.visibleIds.slice(start, end + 1)) {
        if (remove) selected.delete(id)
        else selected.add(id)
      }
      return {
        selectedIds: canonicalIds(selected, scope),
        anchorId: state.anchorId ?? intent.id,
        focusId: intent.id,
      }
    }
    default:
      return intent satisfies never
  }
}

export const flatSelectionScope = (visibleIds: readonly string[]): BlockSelectionScope => ({
  visibleIds,
  parentById: new Map(visibleIds.map((id) => [id, null])),
})

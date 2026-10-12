import type { EditorView } from "prosemirror-view"
import { attachProseMirrorClipboard } from "./prosemirror-clipboard.js"
import { attachSelectionDrag } from "./prosemirror-selection-drag.js"
import {
  isInteractiveTarget,
  isOwnedTarget,
  pointHitsGlyph,
  visibleSelectionScope,
} from "./prosemirror-selection-hit.js"
import {
  type ProseMirrorSelectionState,
  readBlockSelection,
  setBlockSelectionMeta,
  subscribeBlockSelection,
} from "./prosemirror-selection-state.js"
import type {
  BlockSelectionController,
  BlockSelectionOptions,
} from "./prosemirror-selection-types.js"
import {
  initialBlockSelectionState,
  reconcileBlockSelection,
  reduceBlockSelection,
  type SelectionIntent,
  selectionStateForIds,
} from "./selection.js"

export {
  blockSelectionReconcilePlugin,
  type ProseMirrorSelectionMode,
  type ProseMirrorSelectionState,
  readBlockSelection,
} from "./prosemirror-selection-state.js"
export type {
  BlockSelectionController,
  BlockSelectionOptions,
} from "./prosemirror-selection-types.js"

export const attachBlockSelection = (
  view: EditorView,
  options: BlockSelectionOptions,
): BlockSelectionController => {
  const ownerDocument = view.dom.ownerDocument
  let consumedModifierClick = false
  let consumedModifierPointer = false
  let consumedMarqueeClick = false
  const isActive = () => options.isActive?.() ?? true
  const claim = () => {
    options.claim?.()
    return isActive()
  }
  const dispatchSelection = (next: ProseMirrorSelectionState) => {
    const current = readBlockSelection(view.state)
    if (
      current.mode === next.mode &&
      current.anchorId === next.anchorId &&
      current.focusId === next.focusId &&
      current.selectedIds.length === next.selectedIds.length &&
      current.selectedIds.every((id, index) => id === next.selectedIds[index])
    )
      return
    view.dispatch(
      setBlockSelectionMeta(view.state, next)
        .setMeta("addToHistory", false)
        .setMeta("origin", "selection"),
    )
  }
  const apply = (intent: SelectionIntent) =>
    dispatchSelection({
      ...reduceBlockSelection(readBlockSelection(view.state), intent, visibleSelectionScope(view)),
      mode: intent.kind === "clear" ? "none" : "blocks",
    })
  const clear = () => dispatchSelection({ mode: "none", ...initialBlockSelectionState })
  const replace = (blockIds: readonly string[]) => {
    if (!claim()) return
    const selected = selectionStateForIds(blockIds, visibleSelectionScope(view))
    dispatchSelection({ ...selected, mode: selected.selectedIds.length === 0 ? "none" : "blocks" })
  }
  const reconcile = () => {
    const current = readBlockSelection(view.state)
    const selected = reconcileBlockSelection(current, visibleSelectionScope(view))
    dispatchSelection({
      ...selected,
      mode: current.mode === "blocks" && selected.selectedIds.length === 0 ? "none" : current.mode,
    })
  }
  const updateTextSelection = () => {
    const current = readBlockSelection(view.state)
    dispatchSelection({ ...current, mode: "text", selectedIds: [] })
  }
  const selectFromClick = (blockId: string, event: MouseEvent): boolean => {
    if (!claim()) return false
    const kind = event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "replace"
    apply({ kind, id: blockId })
    return kind !== "replace"
  }
  const selection = {
    get mode(): "none" | "text" | "blocks" {
      return readBlockSelection(view.state).mode
    },
    get value(): readonly string[] {
      const current = readBlockSelection(view.state)
      return current.mode === "blocks" ? current.selectedIds : []
    },
  }
  const detachClipboard = attachProseMirrorClipboard(view, { ...options, selection, clear })
  const selectionDrag = attachSelectionDrag(view, replace, updateTextSelection, (active) => {
    consumedMarqueeClick = active
  })
  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof HTMLElement) || !isOwnedTarget(view, event.target)) return
    if (!claim()) return
    if (consumedModifierClick) {
      consumedModifierClick = false
      return
    }
    if (consumedMarqueeClick) {
      consumedMarqueeClick = false
      return
    }
    const modifier = event.shiftKey || event.metaKey || event.ctrlKey
    if (!modifier) {
      updateTextSelection()
      return
    }
    if (isInteractiveTarget(event.target)) return
    const blockId = event.target.closest<HTMLElement>("[data-block-id]")?.dataset["blockId"]
    if (blockId === undefined) return
    event.preventDefault()
    event.stopPropagation()
    selectFromClick(blockId, event)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isActive()) return
    const current = readBlockSelection(view.state)
    if (event.shiftKey && event.key.startsWith("Arrow")) {
      updateTextSelection()
      return
    }
    if (current.mode !== "blocks" || current.selectedIds.length === 0 || event.key !== "Escape")
      return
    event.preventDefault()
    clear()
  }
  const onFocusIn = () => {
    claim()
  }
  const onPointerDown = (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      !(event.target instanceof HTMLElement) ||
      !isOwnedTarget(view, event.target)
    )
      return
    if (!claim()) return
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      if (event.target.closest("button, a, input, textarea, select") !== null) return
      const blockId = event.target.closest<HTMLElement>("[data-block-id]")?.dataset["blockId"]
      if (blockId !== undefined) {
        event.preventDefault()
        event.stopImmediatePropagation()
        consumedModifierClick = true
        consumedModifierPointer = true
        selectFromClick(blockId, event)
      }
      return
    }
    if (isInteractiveTarget(event.target)) return
    const hitsGlyph = pointHitsGlyph(ownerDocument, event.clientX, event.clientY)
    const blockId = event.target.closest<HTMLElement>("[data-block-id]")?.dataset["blockId"]
    if (
      blockId !== undefined &&
      readBlockSelection(view.state).selectedIds.includes(blockId) &&
      !hitsGlyph
    )
      return
    if (hitsGlyph) return
    clear()
    selectionDrag.start(event)
  }
  const onMouseDown = (event: MouseEvent) => {
    if (consumedModifierPointer) {
      consumedModifierPointer = false
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (
      event.button !== 0 ||
      !(event.target instanceof HTMLElement) ||
      !isOwnedTarget(view, event.target) ||
      isInteractiveTarget(event.target) ||
      (!event.metaKey && !event.ctrlKey && !event.shiftKey)
    )
      return
    if (!claim()) return
    const blockId = event.target.closest<HTMLElement>("[data-block-id]")?.dataset["blockId"]
    if (blockId !== undefined) {
      event.preventDefault()
      event.stopImmediatePropagation()
      consumedModifierClick = true
      selectFromClick(blockId, event)
    }
  }
  const onPointerCancel = () => {
    consumedModifierClick = false
    consumedModifierPointer = false
    consumedMarqueeClick = false
  }
  const onDocumentPointerDown = (event: PointerEvent) => {
    if (
      !(event.target instanceof Node) ||
      (event.target instanceof Element
        ? isOwnedTarget(view, event.target)
        : event.target.parentElement !== null && isOwnedTarget(view, event.target.parentElement)) ||
      options.isContextTarget?.(event.target) === true
    )
      return
    clear()
    options.release?.()
  }
  const unsubscribeSelection = subscribeBlockSelection(view, () =>
    options.onSelectionChange?.(selection.value),
  )
  view.dom.addEventListener("click", onClick)
  view.dom.addEventListener("keydown", onKeyDown)
  view.dom.addEventListener("focusin", onFocusIn)
  view.dom.addEventListener("pointerdown", onPointerDown, true)
  view.dom.addEventListener("pointercancel", onPointerCancel, true)
  view.dom.addEventListener("mousedown", onMouseDown, true)
  ownerDocument.addEventListener("pointerdown", onDocumentPointerDown, true)
  return {
    selectFromClick,
    activateText: updateTextSelection,
    replace,
    selectedIds: () => (isActive() ? selection.value : []),
    value: () => readBlockSelection(view.state),
    contains: (blockId) => isActive() && selection.value.includes(blockId),
    clear,
    reconcile,
    destroy: () => {
      unsubscribeSelection()
      detachClipboard()
      selectionDrag.destroy()
      view.dom.removeEventListener("click", onClick)
      view.dom.removeEventListener("keydown", onKeyDown)
      view.dom.removeEventListener("focusin", onFocusIn)
      view.dom.removeEventListener("pointerdown", onPointerDown, true)
      view.dom.removeEventListener("pointercancel", onPointerCancel, true)
      view.dom.removeEventListener("mousedown", onMouseDown, true)
      ownerDocument.removeEventListener("pointerdown", onDocumentPointerDown, true)
    },
  }
}

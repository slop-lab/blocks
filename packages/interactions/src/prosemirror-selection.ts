import { Plugin, PluginKey } from "prosemirror-state"
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view"
import {
  attachProseMirrorClipboard,
  type ProseMirrorClipboardOptions,
} from "./prosemirror-clipboard.js"
import { attachSelectionDrag } from "./prosemirror-selection-drag.js"
import {
  isInteractiveTarget,
  ownedBlockElements,
  pointHitsGlyph,
} from "./prosemirror-selection-hit.js"
import {
  type BlockSelectionScope,
  type BlockSelectionState,
  initialBlockSelectionState,
  reconcileBlockSelection,
  reduceBlockSelection,
  type SelectionIntent,
  selectionStateForIds,
} from "./selection.js"

const updates = new WeakMap<EditorView, () => void>()
const selectionKey = new PluginKey<BlockSelectionState>("block-editor-selection")

const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

const sameSelection = (left: BlockSelectionState, right: BlockSelectionState): boolean =>
  left.anchorId === right.anchorId &&
  left.focusId === right.focusId &&
  sameIds(left.selectedIds, right.selectedIds)

const scopeForElements = (elements: readonly HTMLElement[]): BlockSelectionScope => {
  const visibleIds = elements.flatMap((element) => {
    const id = element.dataset["blockId"]
    return id === undefined ? [] : [id]
  })
  const visible = new Set(visibleIds)
  const parentById = new Map<string, string | null>()
  for (const element of elements) {
    const id = element.dataset["blockId"]
    if (id === undefined) continue
    const parentId =
      element.parentElement?.closest<HTMLElement>("[data-block-id]")?.dataset["blockId"]
    parentById.set(id, parentId !== undefined && visible.has(parentId) ? parentId : null)
  }
  return { visibleIds, parentById }
}

const scopeForView = (view: EditorView): BlockSelectionScope =>
  scopeForElements(ownedBlockElements(view))

const pluginSelection = (view: EditorView): BlockSelectionState =>
  selectionKey.getState(view.state) ?? initialBlockSelectionState

const parseSelectionMeta = (meta: unknown): BlockSelectionState | null => {
  if (typeof meta !== "object" || meta === null || !("selectedIds" in meta)) return null
  const selectedIds = meta.selectedIds
  const anchorId = "anchorId" in meta ? meta.anchorId : null
  const focusId = "focusId" in meta ? meta.focusId : null
  return Array.isArray(selectedIds) &&
    selectedIds.every((id): id is string => typeof id === "string") &&
    (typeof anchorId === "string" || anchorId === null) &&
    (typeof focusId === "string" || focusId === null)
    ? { selectedIds, anchorId, focusId }
    : null
}

export const blockSelectionReconcilePlugin = new Plugin<BlockSelectionState>({
  key: selectionKey,
  state: {
    init: () => initialBlockSelectionState,
    apply: (transaction, current) =>
      parseSelectionMeta(transaction.getMeta(selectionKey)) ?? current,
  },
  props: {
    decorations: (state) => {
      const selected = new Set(selectionKey.getState(state)?.selectedIds ?? [])
      const decorations: Decoration[] = []
      state.doc.descendants((node, position) => {
        if (selected.has(String(node.attrs["id"])))
          decorations.push(
            Decoration.node(position, position + node.nodeSize, {
              class: "block-selected",
              "aria-current": "true",
              "data-block-selected": "true",
            }),
          )
        return true
      })
      return DecorationSet.create(state.doc, decorations)
    },
  },
  view: (view) => {
    const project = () => {
      const selectedIds = pluginSelection(view).selectedIds
      view.dom.classList.toggle("block-selection-active", selectedIds.length > 0)
      view.dom.dataset["selectedBlockIds"] = selectedIds.join(" ")
      updates.get(view)?.()
    }
    project()
    return {
      update: (updatedView, previousState) => {
        const previous = selectionKey.getState(previousState) ?? initialBlockSelectionState
        const current = pluginSelection(updatedView)
        if (!sameSelection(previous, current) || !updatedView.state.doc.eq(previousState.doc))
          project()
      },
      destroy: () => updates.delete(view),
    }
  },
})

export type BlockSelectionController = {
  readonly selectFromClick: (blockId: string, event: MouseEvent) => boolean
  readonly replace: (blockIds: readonly string[]) => void
  readonly selectedIds: () => readonly string[]
  readonly contains: (blockId: string) => boolean
  readonly clear: () => void
  readonly reconcile: () => void
  readonly destroy: () => void
}

export type BlockSelectionOptions = ProseMirrorClipboardOptions & {
  readonly onSelectionChange?: (blockIds: readonly string[]) => void
  readonly isContextTarget?: (target: Node) => boolean
}

export const attachBlockSelection = (
  view: EditorView,
  options: BlockSelectionOptions,
): BlockSelectionController => {
  const ownerDocument = view.dom.ownerDocument
  let consumedModifierClick = false
  let consumedModifierPointer = false
  let consumedMarqueeClick = false
  const dispatchSelection = (next: BlockSelectionState) => {
    if (sameSelection(pluginSelection(view), next)) return
    view.dispatch(
      view.state.tr
        .setMeta(selectionKey, next)
        .setMeta("addToHistory", false)
        .setMeta("origin", "selection"),
    )
  }
  const apply = (intent: SelectionIntent) =>
    dispatchSelection(reduceBlockSelection(pluginSelection(view), intent, scopeForView(view)))
  const clear = () => apply({ kind: "clear" })
  const replace = (blockIds: readonly string[]) =>
    dispatchSelection(selectionStateForIds(blockIds, scopeForView(view)))
  const reconcile = () =>
    dispatchSelection(reconcileBlockSelection(pluginSelection(view), scopeForView(view)))
  const selectFromClick = (blockId: string, event: MouseEvent): boolean => {
    const kind = event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "replace"
    apply({ kind, id: blockId })
    return kind !== "replace"
  }
  const selection = {
    get value(): readonly string[] {
      return pluginSelection(view).selectedIds
    },
  }
  const detachClipboard = attachProseMirrorClipboard(view, { ...options, selection, clear })
  const selectionDrag = attachSelectionDrag(view, replace, clear, (active) => {
    consumedMarqueeClick = active
  })
  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof HTMLElement) || event.target.closest(".ProseMirror") !== view.dom)
      return
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
      clear()
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
    if (pluginSelection(view).selectedIds.length === 0 || event.key !== "Escape") return
    event.preventDefault()
    clear()
  }
  const onPointerDown = (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      !(event.target instanceof HTMLElement) ||
      event.target.closest(".ProseMirror") !== view.dom
    )
      return
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
    if (blockId !== undefined && pluginSelection(view).selectedIds.includes(blockId) && !hitsGlyph)
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
      event.target.closest(".ProseMirror") !== view.dom ||
      isInteractiveTarget(event.target) ||
      (!event.metaKey && !event.ctrlKey && !event.shiftKey)
    )
      return
    const blockId = event.target.closest<HTMLElement>("[data-block-id]")?.dataset["blockId"]
    if (blockId !== undefined) {
      event.preventDefault()
      event.stopImmediatePropagation()
      consumedModifierClick = true
      selectFromClick(blockId, event)
    }
  }
  const onDocumentPointerDown = (event: PointerEvent) => {
    if (
      !(event.target instanceof Node) ||
      view.dom.contains(event.target) ||
      options.isContextTarget?.(event.target) === true
    )
      return
    clear()
  }
  updates.set(view, () => options.onSelectionChange?.(pluginSelection(view).selectedIds))
  view.dom.addEventListener("click", onClick)
  view.dom.addEventListener("keydown", onKeyDown)
  view.dom.addEventListener("pointerdown", onPointerDown, true)
  view.dom.addEventListener("mousedown", onMouseDown, true)
  ownerDocument.addEventListener("pointerdown", onDocumentPointerDown, true)
  return {
    selectFromClick,
    replace,
    selectedIds: () => pluginSelection(view).selectedIds,
    contains: (blockId) => pluginSelection(view).selectedIds.includes(blockId),
    clear,
    reconcile,
    destroy: () => {
      updates.delete(view)
      detachClipboard()
      selectionDrag.destroy()
      view.dom.removeEventListener("click", onClick)
      view.dom.removeEventListener("keydown", onKeyDown)
      view.dom.removeEventListener("pointerdown", onPointerDown, true)
      view.dom.removeEventListener("mousedown", onMouseDown, true)
      ownerDocument.removeEventListener("pointerdown", onDocumentPointerDown, true)
    },
  }
}

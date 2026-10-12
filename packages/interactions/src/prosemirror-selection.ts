import { Plugin, PluginKey } from "prosemirror-state"
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view"
import { BlockSelection } from "./index.js"
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

const updates = new WeakMap<EditorView, () => void>()
const selectionKey = new PluginKey<readonly string[]>("block-editor-selection")

export const blockSelectionReconcilePlugin = new Plugin<readonly string[]>({
  key: selectionKey,
  state: {
    init: (): readonly string[] => [],
    apply: (transaction, value) => {
      const meta: unknown = transaction.getMeta(selectionKey)
      return Array.isArray(meta) ? meta.filter((id): id is string => typeof id === "string") : value
    },
  },
  props: {
    decorations: (state) => {
      const selected = new Set(selectionKey.getState(state) ?? [])
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
    const ownerWindow = view.dom.ownerDocument.defaultView
    let frame = 0
    return {
      update: (updatedView, previousState) => {
        if (
          updatedView.state.doc.eq(previousState.doc) &&
          updatedView.state.selection.eq(previousState.selection)
        )
          return
        ownerWindow?.cancelAnimationFrame(frame)
        frame = ownerWindow?.requestAnimationFrame(() => updates.get(updatedView)?.()) ?? 0
      },
      destroy: () => {
        ownerWindow?.cancelAnimationFrame(frame)
        updates.delete(view)
      },
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
}

export const attachBlockSelection = (
  view: EditorView,
  options: BlockSelectionOptions,
): BlockSelectionController => {
  const ownerDocument = view.dom.ownerDocument
  const selection = new BlockSelection()
  let consumedModifierClick = false
  let consumedModifierPointer = false
  let renderFrame = 0

  const visibleIds = (): readonly string[] =>
    ownedBlockElements(view).flatMap((element) =>
      element.dataset["blockId"] === undefined ? [] : [element.dataset["blockId"]],
    )
  const render = () => {
    const selected = new Set(selection.value)
    for (const element of ownedBlockElements(view)) {
      const active = selected.has(element.dataset["blockId"] ?? "")
      element.classList.toggle("block-selected", active)
      if (active) {
        element.dataset["blockSelected"] = "true"
        element.setAttribute("aria-current", "true")
      } else {
        delete element.dataset["blockSelected"]
        element.removeAttribute("aria-current")
      }
    }
    view.dom.classList.toggle("block-selection-active", selected.size > 0)
    view.dom.dataset["selectedBlockIds"] = selection.value.join(" ")
    const decorated = selectionKey.getState(view.state) ?? []
    if (
      decorated.length !== selection.value.length ||
      decorated.some((id, index) => id !== selection.value[index])
    )
      view.dispatch(
        view.state.tr
          .setMeta(selectionKey, selection.value)
          .setMeta("addToHistory", false)
          .setMeta("origin", "selection"),
      )
    options.onSelectionChange?.(selection.value)
  }
  const renderAfterNativeEvent = () => {
    ownerDocument.defaultView?.cancelAnimationFrame(renderFrame)
    renderFrame = ownerDocument.defaultView?.requestAnimationFrame(render) ?? 0
  }
  const reconcile = () => {
    selection.reconcile(visibleIds())
    render()
  }
  const clear = () => {
    selection.apply({ kind: "clear" }, visibleIds())
    render()
  }
  const selectFromClick = (blockId: string, event: MouseEvent): boolean => {
    const kind = event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "replace"
    selection.apply({ kind, id: blockId }, visibleIds())
    render()
    return kind !== "replace"
  }
  const replace = (blockIds: readonly string[]) => {
    const visible = visibleIds()
    selection.apply({ kind: "clear" }, visible)
    for (const id of visible) {
      if (blockIds.includes(id)) selection.apply({ kind: "toggle", id }, visible)
    }
    render()
  }
  const detachClipboard = attachProseMirrorClipboard(view, { ...options, selection, clear })
  const selectionDrag = attachSelectionDrag(view, selection, visibleIds, render)
  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof HTMLElement) || event.target.closest(".ProseMirror") !== view.dom)
      return
    if (consumedModifierClick) {
      consumedModifierClick = false
      return
    }
    const modifier = event.shiftKey || event.metaKey || event.ctrlKey
    if (!modifier) {
      if (selection.value.length > 0) clear()
      return
    }
    if (isInteractiveTarget(event.target)) return
    const block = event.target.closest<HTMLElement>("[data-block-id]")
    const blockId = block?.dataset["blockId"]
    if (blockId === undefined) return
    event.preventDefault()
    event.stopPropagation()
    selectFromClick(blockId, event)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (selection.value.length === 0) return
    if (event.key === "Escape") {
      event.preventDefault()
      clear()
    }
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
        renderAfterNativeEvent()
      }
      return
    }
    if (isInteractiveTarget(event.target)) return
    const hitsGlyph = pointHitsGlyph(ownerDocument, event.clientX, event.clientY)
    const blockId = event.target.closest<HTMLElement>("[data-block-id]")?.dataset["blockId"]
    if (blockId !== undefined && selection.value.includes(blockId) && !hitsGlyph) return
    if (hitsGlyph) return
    if (selection.value.length > 0) clear()
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
  updates.set(view, reconcile)
  view.dom.addEventListener("click", onClick)
  view.dom.addEventListener("keydown", onKeyDown)
  view.dom.addEventListener("pointerdown", onPointerDown, true)
  view.dom.addEventListener("mousedown", onMouseDown, true)
  return {
    selectFromClick,
    replace,
    selectedIds: () => selection.value,
    contains: (blockId) => selection.value.includes(blockId),
    clear,
    reconcile,
    destroy: () => {
      updates.delete(view)
      ownerDocument.defaultView?.cancelAnimationFrame(renderFrame)
      detachClipboard()
      selectionDrag.destroy()
      view.dom.removeEventListener("click", onClick)
      view.dom.removeEventListener("keydown", onKeyDown)
      view.dom.removeEventListener("pointerdown", onPointerDown, true)
      view.dom.removeEventListener("mousedown", onMouseDown, true)
    },
  }
}

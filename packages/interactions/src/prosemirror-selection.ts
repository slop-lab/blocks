import { Plugin } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { BlockSelection } from "./index.js"
import {
  attachProseMirrorClipboard,
  type ProseMirrorClipboardOptions,
} from "./prosemirror-clipboard.js"

const updates = new WeakMap<EditorView, () => void>()

export const blockSelectionReconcilePlugin = new Plugin({
  view: (view) => {
    const ownerWindow = view.dom.ownerDocument.defaultView
    let frame = 0
    return {
      update: (updatedView, previousState) => {
        if (updatedView.state.doc.eq(previousState.doc)) return
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
  readonly selectedIds: () => readonly string[]
  readonly contains: (blockId: string) => boolean
  readonly clear: () => void
  readonly reconcile: () => void
  readonly destroy: () => void
}

export type BlockSelectionOptions = ProseMirrorClipboardOptions & {
  readonly onSelectionChange?: (blockIds: readonly string[]) => void
}

const blockElements = (view: EditorView): readonly HTMLElement[] =>
  Array.from(view.dom.querySelectorAll<HTMLElement>("[data-block-id]")).filter(
    (element) => element.closest(".ProseMirror") === view.dom,
  )

const leafBlockElements = (view: EditorView): readonly HTMLElement[] =>
  blockElements(view).filter(
    (element) =>
      !Array.from(element.querySelectorAll<HTMLElement>("[data-block-id]")).some(
        (child) => child.closest(".ProseMirror") === view.dom,
      ),
  )

const interactiveTarget = (target: HTMLElement): boolean =>
  target.closest("button, a, input, textarea, select, [contenteditable='false']") !== null

export const attachBlockSelection = (
  view: EditorView,
  options: BlockSelectionOptions,
): BlockSelectionController => {
  const ownerDocument = view.dom.ownerDocument
  const selection = new BlockSelection()
  let marquee: {
    readonly pointerId: number
    readonly startX: number
    readonly startY: number
  } | null = null
  const marqueeElement = ownerDocument.createElement("div")
  marqueeElement.className = "block-selection-marquee"
  marqueeElement.hidden = true
  ownerDocument.body.append(marqueeElement)

  const visibleIds = (): readonly string[] =>
    blockElements(view).flatMap((element) =>
      element.dataset["blockId"] === undefined ? [] : [element.dataset["blockId"]],
    )
  const render = () => {
    const selected = new Set(selection.value)
    for (const element of blockElements(view))
      element.classList.toggle("block-selected", selected.has(element.dataset["blockId"] ?? ""))
    view.dom.classList.toggle("block-selection-active", selected.size > 0)
    options.onSelectionChange?.(selection.value)
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
  const detachClipboard = attachProseMirrorClipboard(view, { ...options, selection, clear })
  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof HTMLElement) || event.target.closest(".ProseMirror") !== view.dom)
      return
    const modifier = event.shiftKey || event.metaKey || event.ctrlKey
    if (!modifier) {
      if (selection.value.length > 0) clear()
      return
    }
    if (interactiveTarget(event.target)) return
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
    if (event.button !== 0 || event.target !== view.dom) return
    marquee = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY }
    view.dom.setPointerCapture(event.pointerId)
    marqueeElement.hidden = false
  }
  const onPointerMove = (event: PointerEvent) => {
    if (marquee === null || event.pointerId !== marquee.pointerId) return
    const left = Math.min(marquee.startX, event.clientX)
    const top = Math.min(marquee.startY, event.clientY)
    const right = Math.max(marquee.startX, event.clientX)
    const bottom = Math.max(marquee.startY, event.clientY)
    Object.assign(marqueeElement.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
    })
    const ids = blockElements(view).flatMap((element) => {
      const rect = element.getBoundingClientRect()
      const id = element.dataset["blockId"]
      return id !== undefined &&
        rect.right >= left &&
        rect.left <= right &&
        rect.bottom >= top &&
        rect.top <= bottom
        ? [id]
        : []
    })
    selection.apply({ kind: "clear" }, visibleIds())
    for (const id of ids) selection.apply({ kind: "toggle", id }, visibleIds())
    render()
  }
  const onNativeSelectionChange = () => {
    const native = ownerDocument.getSelection()
    if (native === null || native.isCollapsed || native.rangeCount !== 1) return
    const range = native.getRangeAt(0)
    if (!view.dom.contains(range.startContainer) || !view.dom.contains(range.endContainer)) return
    const intersected = leafBlockElements(view).filter((element) => range.intersectsNode(element))
    if (intersected.length < 2) return
    const fullySelected = intersected.every((element) => {
      const blockRange = ownerDocument.createRange()
      blockRange.selectNodeContents(element)
      return (
        range.compareBoundaryPoints(Range.START_TO_START, blockRange) <= 0 &&
        range.compareBoundaryPoints(Range.END_TO_END, blockRange) >= 0
      )
    })
    if (!fullySelected) return
    selection.apply({ kind: "clear" }, visibleIds())
    for (const element of intersected) {
      const id = element.dataset["blockId"]
      if (id !== undefined) selection.apply({ kind: "toggle", id }, visibleIds())
    }
    render()
  }
  const finishMarquee = () => {
    marquee = null
    marqueeElement.hidden = true
  }
  updates.set(view, reconcile)
  view.dom.addEventListener("click", onClick)
  view.dom.addEventListener("keydown", onKeyDown)
  view.dom.addEventListener("pointerdown", onPointerDown)
  ownerDocument.addEventListener("pointermove", onPointerMove)
  ownerDocument.addEventListener("pointerup", finishMarquee)
  ownerDocument.addEventListener("selectionchange", onNativeSelectionChange)
  return {
    selectFromClick,
    selectedIds: () => selection.value,
    contains: (blockId) => selection.value.includes(blockId),
    clear,
    reconcile,
    destroy: () => {
      updates.delete(view)
      detachClipboard()
      marqueeElement.remove()
      view.dom.removeEventListener("click", onClick)
      view.dom.removeEventListener("keydown", onKeyDown)
      view.dom.removeEventListener("pointerdown", onPointerDown)
      ownerDocument.removeEventListener("pointermove", onPointerMove)
      ownerDocument.removeEventListener("pointerup", finishMarquee)
      ownerDocument.removeEventListener("selectionchange", onNativeSelectionChange)
    },
  }
}

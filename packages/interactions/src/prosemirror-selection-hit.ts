import type { EditorView } from "prosemirror-view"
import { selectionScopeForDocument } from "./prosemirror-selection-state.js"

export const ownedBlockElements = (view: EditorView): readonly HTMLElement[] =>
  Array.from(view.dom.querySelectorAll<HTMLElement>("[data-block-id]")).filter(
    (element) =>
      element.closest(".ProseMirror") === view.dom &&
      element.closest("[data-interaction-context-boundary]") === null,
  )

export const isOwnedTarget = (view: EditorView, target: Element): boolean =>
  target.closest(".ProseMirror") === view.dom &&
  target.closest("[data-interaction-context-boundary]") === null

export const visibleSelectionScope = (view: EditorView) =>
  selectionScopeForDocument(
    view.state.doc,
    ownedBlockElements(view).flatMap((element) => {
      const id = element.dataset["blockId"]
      return id === undefined ? [] : [id]
    }),
  )

export const ownedLeafBlockElements = (view: EditorView): readonly HTMLElement[] =>
  ownedBlockElements(view).filter(
    (element) =>
      !Array.from(element.querySelectorAll<HTMLElement>("[data-block-id]")).some(
        (child) => child.closest(".ProseMirror") === view.dom,
      ),
  )

export const isInteractiveTarget = (target: HTMLElement): boolean =>
  target.closest("button, a, input, textarea, select, [contenteditable='false']") !== null

export const pointHitsGlyph = (ownerDocument: Document, x: number, y: number): boolean => {
  const caret = ownerDocument.caretPositionFromPoint?.(x, y)
  const node = caret?.offsetNode
  if (
    caret === undefined ||
    caret === null ||
    node === undefined ||
    node.nodeType !== Node.TEXT_NODE
  )
    return false
  const text = node.textContent ?? ""
  if (text.length === 0) return false
  const offset = Math.min(caret.offset, text.length - 1)
  const range = ownerDocument.createRange()
  range.setStart(node, offset)
  range.setEnd(node, offset + 1)
  return Array.from(range.getClientRects()).some(
    (rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
  )
}

export const intersectingLeafIds = (
  view: EditorView,
  bounds: {
    readonly left: number
    readonly top: number
    readonly right: number
    readonly bottom: number
  },
): readonly string[] =>
  ownedLeafBlockElements(view).flatMap((element) => {
    const rect = element.getBoundingClientRect()
    const id = element.dataset["blockId"]
    return id !== undefined &&
      rect.right > bounds.left &&
      rect.left < bounds.right &&
      rect.bottom > bounds.top &&
      rect.top < bounds.bottom
      ? [id]
      : []
  })

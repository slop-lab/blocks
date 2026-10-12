import type { EditorView } from "prosemirror-view"
import { isOwnedTarget } from "./prosemirror-selection-hit.js"

type SelectionContextBoundaryOptions = {
  readonly view: EditorView
  readonly isContextTarget?: (target: Node) => boolean
  readonly clear: () => void
  readonly release?: () => void
}

type SelectionContextBoundary = {
  readonly shouldAcceptNativeTextSelection: () => boolean
  readonly destroy: () => void
}

export const attachSelectionContextBoundary = (
  options: SelectionContextBoundaryOptions,
): SelectionContextBoundary => {
  const ownerDocument = options.view.dom.ownerDocument
  let contextPointerId: number | null = null
  const onPointerDown = (event: PointerEvent) => {
    if (event.target instanceof Node && options.isContextTarget?.(event.target) === true) {
      contextPointerId = event.pointerId
      return
    }
    contextPointerId = null
    if (
      !(event.target instanceof Node) ||
      (event.target instanceof Element
        ? isOwnedTarget(options.view, event.target)
        : event.target.parentElement !== null &&
          isOwnedTarget(options.view, event.target.parentElement))
    )
      return
    options.clear()
    options.release?.()
  }
  const onPointerFinish = (event: PointerEvent) => {
    if (contextPointerId === event.pointerId) contextPointerId = null
  }
  ownerDocument.addEventListener("pointerdown", onPointerDown, true)
  ownerDocument.addEventListener("pointerup", onPointerFinish, true)
  ownerDocument.addEventListener("pointercancel", onPointerFinish, true)
  return {
    shouldAcceptNativeTextSelection: () => {
      const activeElement = ownerDocument.activeElement
      return (
        contextPointerId === null &&
        (activeElement === null || options.isContextTarget?.(activeElement) !== true)
      )
    },
    destroy: () => {
      ownerDocument.removeEventListener("pointerdown", onPointerDown, true)
      ownerDocument.removeEventListener("pointerup", onPointerFinish, true)
      ownerDocument.removeEventListener("pointercancel", onPointerFinish, true)
    },
  }
}

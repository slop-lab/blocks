import type { EditorView } from "prosemirror-view"
import { intersectingLeafIds, ownedLeafBlockElements } from "./prosemirror-selection-hit.js"

type SelectionDrag = {
  readonly start: (event: PointerEvent) => void
  readonly destroy: () => void
}

type SelectionDragOptions = {
  readonly view: EditorView
  readonly replace: (ids: readonly string[]) => void
  readonly activateText: () => void
  readonly onFinish: (active: boolean) => void
  readonly shouldAcceptNativeTextSelection: () => boolean
}

export const attachSelectionDrag = (options: SelectionDragOptions): SelectionDrag => {
  const { view } = options
  const ownerDocument = view.dom.ownerDocument
  const element = ownerDocument.createElement("div")
  element.className = "block-selection-marquee"
  element.hidden = true
  ownerDocument.body.append(element)
  let marquee: {
    readonly pointerId: number
    readonly startX: number
    readonly startY: number
    active: boolean
  } | null = null

  const onPointerMove = (event: PointerEvent) => {
    if (marquee === null || event.pointerId !== marquee.pointerId) return
    if (
      !marquee.active &&
      Math.hypot(event.clientX - marquee.startX, event.clientY - marquee.startY) < 6
    )
      return
    marquee.active = true
    element.hidden = false
    const left = Math.min(marquee.startX, event.clientX)
    const top = Math.min(marquee.startY, event.clientY)
    const right = Math.max(marquee.startX, event.clientX)
    const bottom = Math.max(marquee.startY, event.clientY)
    Object.assign(element.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
    })
    options.replace(intersectingLeafIds(view, { left, top, right, bottom }))
  }
  const onNativeSelectionChange = () => {
    if (!options.shouldAcceptNativeTextSelection()) return
    const native = ownerDocument.getSelection()
    if (native === null || native.isCollapsed || native.rangeCount !== 1) return
    const range = native.getRangeAt(0)
    if (!view.dom.contains(range.startContainer) || !view.dom.contains(range.endContainer)) return
    const intersected = ownedLeafBlockElements(view).filter((block) => range.intersectsNode(block))
    if (intersected.length < 2) {
      options.activateText()
      return
    }
    const fullySelected = intersected.every((block) => {
      const blockRange = ownerDocument.createRange()
      blockRange.selectNodeContents(block)
      return (
        range.compareBoundaryPoints(Range.START_TO_START, blockRange) <= 0 &&
        range.compareBoundaryPoints(Range.END_TO_END, blockRange) >= 0
      )
    })
    if (!fullySelected) {
      options.activateText()
      return
    }
    options.replace(
      intersected.flatMap((block) => {
        const id = block.dataset["blockId"]
        return id === undefined ? [] : [id]
      }),
    )
  }
  const finish = (event: PointerEvent, completed: boolean) => {
    if (marquee === null || event.pointerId !== marquee.pointerId) return
    if (view.dom.hasPointerCapture(event.pointerId)) view.dom.releasePointerCapture(event.pointerId)
    options.onFinish(completed && marquee.active)
    marquee = null
    element.hidden = true
  }
  const onPointerUp = (event: PointerEvent) => finish(event, true)
  const onPointerCancel = (event: PointerEvent) => finish(event, false)
  ownerDocument.addEventListener("pointermove", onPointerMove)
  ownerDocument.addEventListener("pointerup", onPointerUp)
  ownerDocument.addEventListener("pointercancel", onPointerCancel)
  ownerDocument.addEventListener("selectionchange", onNativeSelectionChange)
  return {
    start: (event) => {
      marquee = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
      }
      view.dom.setPointerCapture(event.pointerId)
    },
    destroy: () => {
      element.remove()
      ownerDocument.removeEventListener("pointermove", onPointerMove)
      ownerDocument.removeEventListener("pointerup", onPointerUp)
      ownerDocument.removeEventListener("pointercancel", onPointerCancel)
      ownerDocument.removeEventListener("selectionchange", onNativeSelectionChange)
    },
  }
}

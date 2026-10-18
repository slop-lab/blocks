import type { Node as ProseMirrorNode } from "prosemirror-model"
import type { EditorView } from "prosemirror-view"
import type { BlockDropTarget } from "./block-drop-commands"
import { planBlockDrop } from "./block-drop-target"
import { blockIndexById } from "./block-interaction-commands"

type DragState = {
  readonly blockId: string
  readonly blockIds: readonly string[]
  readonly pointerId: number
  readonly start: PointerPoint
  readonly document: ProseMirrorNode
  target: BlockDropTarget
}

type PointerPoint = { readonly x: number; readonly y: number }

type GripDragOptions = {
  readonly activate: () => void
  readonly activeBlockId: () => string | null
  readonly begin: (blockId: string) => readonly string[]
  readonly childCount: (blockId: string) => number
  readonly isCurrent: () => boolean
  readonly canMove: (blockIds: readonly string[], target: BlockDropTarget) => boolean
  readonly move: (blockIds: readonly string[], target: BlockDropTarget) => void
}

const dragThreshold = 6
const edgeSize = 48
const scrollStep = 24

export const attachGripDrag = (
  view: EditorView,
  grip: HTMLButtonElement,
  options: GripDragOptions,
): { readonly destroy: () => void; readonly consumeClick: () => boolean } => {
  const ownerDocument = view.dom.ownerDocument
  const indicator = ownerDocument.createElement("div")
  indicator.className = "block-drop-indicator"
  indicator.hidden = true
  ownerDocument.body.append(indicator)
  let drag: DragState | null = null
  let dragged = false
  let lastPoint: PointerPoint | null = null
  let scrollFrame = 0
  let scrollOwner: HTMLElement | null = null

  const blockIndex = (blockId: string): number => blockIndexById(view.state.doc, blockId)
  const finish = (resetClick = false) => {
    if (drag !== null && grip.hasPointerCapture(drag.pointerId))
      grip.releasePointerCapture(drag.pointerId)
    ownerDocument.defaultView?.cancelAnimationFrame(scrollFrame)
    scrollFrame = 0
    drag = null
    lastPoint = null
    scrollOwner = null
    if (resetClick) dragged = false
    indicator.hidden = true
    grip.classList.remove("block-control--dragging")
  }
  const findScrollOwner = (): HTMLElement | null => {
    const viewport = ownerDocument.defaultView
    for (let element = view.dom.parentElement; element !== null; element = element.parentElement) {
      const overflow = viewport?.getComputedStyle(element).overflowY
      if (
        (overflow === "auto" || overflow === "scroll") &&
        element.scrollHeight > element.clientHeight
      )
        return element
    }
    const scrollingElement = ownerDocument.scrollingElement
    return scrollingElement instanceof HTMLElement &&
      scrollingElement.scrollHeight > scrollingElement.clientHeight
      ? scrollingElement
      : null
  }
  const showIndicator = (rect: DOMRect, atStart: boolean, inset = 0) => {
    indicator.hidden = false
    indicator.style.left = `${rect.left + inset}px`
    indicator.style.width = `${Math.max(0, rect.width - inset)}px`
    indicator.style.top = `${atStart ? rect.top : rect.bottom}px`
  }
  const updateDropTarget = (clientX: number, clientY: number) => {
    if (drag === null) return
    if (!view.state.doc.eq(drag.document) || !options.isCurrent()) {
      indicator.hidden = true
      return
    }
    const plan = planBlockDrop(
      {
        root: view.dom,
        ownerDocument,
        edgeSize,
        rootChildCount: view.state.doc.childCount,
        blockIndex,
        childCount: options.childCount,
        canMove: options.canMove,
      },
      drag.blockIds,
      { x: clientX, y: clientY },
    )
    if (plan === null) indicator.hidden = true
    else {
      drag.target = plan.target
      showIndicator(plan.rect, plan.atStart, plan.inset)
    }
  }
  const runAutoscroll = () => {
    scrollFrame = 0
    if (!dragged || drag === null || lastPoint === null || scrollOwner === null) return
    const viewport = ownerDocument.defaultView
    const visualViewport = viewport?.visualViewport
    const viewportTop = visualViewport?.offsetTop ?? 0
    const viewportBottom = viewportTop + (visualViewport?.height ?? viewport?.innerHeight ?? 0)
    const rect = scrollOwner.getBoundingClientRect()
    const top = Math.max(rect.top, viewportTop)
    const bottom = Math.min(rect.bottom, viewportBottom)
    const delta =
      lastPoint.y < top + edgeSize ? -scrollStep : lastPoint.y > bottom - edgeSize ? scrollStep : 0
    if (delta === 0) return
    const previous = scrollOwner.scrollTop
    scrollOwner.scrollBy({ top: delta })
    updateDropTarget(
      Math.max(0, Math.min(lastPoint.x, (viewport?.innerWidth ?? lastPoint.x) - 1)),
      Math.max(viewportTop, Math.min(lastPoint.y, viewportBottom - 1)),
    )
    if (scrollOwner.scrollTop !== previous)
      scrollFrame = viewport?.requestAnimationFrame(runAutoscroll) ?? 0
  }
  const onPointerDown = (event: PointerEvent) => {
    const blockId = options.activeBlockId()
    if (
      blockId === null ||
      grip.disabled ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey
    )
      return
    event.preventDefault()
    options.activate()
    const blockIds = options.begin(blockId)
    if (blockIds.length === 0) return
    dragged = false
    const start = { x: event.clientX, y: event.clientY }
    const source = view.dom.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`)
    const parent = source?.parentElement?.closest<HTMLElement>("[data-block-id]")
    drag = {
      blockId,
      blockIds,
      pointerId: event.pointerId,
      start,
      document: view.state.doc,
      target: { parentId: parent?.dataset["blockId"] ?? null, index: blockIndex(blockId) },
    }
    lastPoint = { x: event.clientX, y: event.clientY }
    grip.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent) => {
    if (drag === null || event.pointerId !== drag.pointerId) return
    lastPoint = { x: event.clientX, y: event.clientY }
    if (
      !dragged &&
      Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < dragThreshold
    )
      return
    if (!dragged) {
      dragged = true
      scrollOwner = findScrollOwner()
      grip.classList.add("block-control--dragging")
    }
    updateDropTarget(event.clientX, event.clientY)
    if (scrollFrame === 0)
      scrollFrame = ownerDocument.defaultView?.requestAnimationFrame(runAutoscroll) ?? 0
  }
  const onPointerUp = (event: PointerEvent) => {
    if (drag === null || event.pointerId !== drag.pointerId) return
    if (!dragged) {
      finish(true)
      return
    }
    updateDropTarget(event.clientX, event.clientY)
    const current = drag
    const validDrop =
      !indicator.hidden && view.state.doc.eq(current.document) && options.isCurrent()
    finish()
    if (validDrop) options.move(current.blockIds, current.target)
  }
  const onScroll = () => {
    if (lastPoint !== null) updateDropTarget(lastPoint.x, lastPoint.y)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") finish()
  }
  const onPointerCancel = (event: PointerEvent) => {
    if (drag !== null && event.pointerId === drag.pointerId) finish(true)
  }
  grip.addEventListener("pointerdown", onPointerDown)
  ownerDocument.addEventListener("pointermove", onPointerMove)
  ownerDocument.addEventListener("pointerup", onPointerUp)
  ownerDocument.addEventListener("pointercancel", onPointerCancel)
  ownerDocument.addEventListener("keydown", onKeyDown)
  ownerDocument.addEventListener("scroll", onScroll, true)
  return {
    consumeClick: () => {
      const consume = dragged
      dragged = false
      return consume
    },
    destroy: () => {
      finish(true)
      indicator.remove()
      grip.removeEventListener("pointerdown", onPointerDown)
      ownerDocument.removeEventListener("pointermove", onPointerMove)
      ownerDocument.removeEventListener("pointerup", onPointerUp)
      ownerDocument.removeEventListener("pointercancel", onPointerCancel)
      ownerDocument.removeEventListener("keydown", onKeyDown)
      ownerDocument.removeEventListener("scroll", onScroll, true)
    },
  }
}

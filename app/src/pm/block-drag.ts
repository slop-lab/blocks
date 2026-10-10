import type { EditorView } from "prosemirror-view"

type DragState = {
  readonly blockId: string
  readonly pointerId: number
  readonly start: PointerPoint
  targetGap: number
}

type PointerPoint = { readonly x: number; readonly y: number }

type GripDragOptions = {
  readonly activeBlockId: () => string | null
  readonly move: (blockId: string, targetGap: number) => void
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

  const blockIndex = (blockId: string): number => {
    let found = -1
    view.state.doc.forEach((node, _position, index) => {
      if (node.attrs["id"] === blockId) found = index
    })
    return found
  }
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
  const showIndicator = (rect: DOMRect, atStart: boolean) => {
    indicator.hidden = false
    indicator.style.left = `${rect.left}px`
    indicator.style.width = `${rect.width}px`
    indicator.style.top = `${atStart ? rect.top : rect.bottom}px`
  }
  const updateDropTarget = (clientX: number, clientY: number) => {
    if (drag === null) return
    const hit = ownerDocument.elementFromPoint(clientX, clientY)
    let target: Element | null = hit
    while (target !== null && target.parentElement !== view.dom) target = target.parentElement
    if (target instanceof HTMLElement && target.matches("[data-block-id]")) {
      const id = target.dataset["blockId"]
      if (id === undefined) return
      const index = blockIndex(id)
      if (index < 0) {
        indicator.hidden = true
        return
      }
      const rect = target.getBoundingClientRect()
      const atStart = clientY < rect.top + rect.height / 2
      drag.targetGap = atStart ? index : index + 1
      showIndicator(rect, atStart)
      return
    }
    const blocks = [...view.dom.children].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element.hasAttribute("data-block-id"),
    )
    const first = blocks[0] ?? null
    const last = blocks.at(-1) ?? null
    const editorRect = view.dom.getBoundingClientRect()
    if (
      first === null ||
      last === null ||
      clientX < editorRect.left ||
      clientX > editorRect.right
    ) {
      indicator.hidden = true
      return
    }
    if (clientY < first.getBoundingClientRect().top) {
      drag.targetGap = 0
      showIndicator(first.getBoundingClientRect(), true)
    } else if (clientY > last.getBoundingClientRect().bottom) {
      drag.targetGap = view.state.doc.childCount
      showIndicator(last.getBoundingClientRect(), false)
    } else indicator.hidden = true
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
    if (blockId === null || grip.disabled || event.button !== 0) return
    event.preventDefault()
    dragged = false
    const start = { x: event.clientX, y: event.clientY }
    drag = { blockId, pointerId: event.pointerId, start, targetGap: blockIndex(blockId) }
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
    const validDrop = !indicator.hidden
    finish()
    if (validDrop) options.move(current.blockId, current.targetGap)
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

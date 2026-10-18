import type { EditorView } from "prosemirror-view"
import { insideRailCorridor } from "./block-pointer-intent"

type RailPointerOptions = {
  readonly rail: HTMLElement
  readonly targetId: () => string | null
  readonly activeRect: () => DOMRect | null
  readonly ownsBlock: (block: HTMLElement) => boolean
  readonly show: (block: HTMLElement) => void
}

type SelectionRailOptions = {
  readonly claim: () => void
  readonly ownedBlockById: (id: string) => HTMLElement | null
  readonly show: (block: HTMLElement) => void
}

const blockElement = (target: EventTarget | null): HTMLElement | null => {
  const element = target instanceof HTMLElement ? target : null
  return element?.closest<HTMLElement>("[data-block-id]") ?? null
}

export const createSelectionRailRefresher =
  (view: EditorView, options: SelectionRailOptions): ((event?: Event) => void) =>
  (event) => {
    if (event?.target instanceof Element && event.target.closest(".ProseMirror") !== view.dom)
      return
    options.claim()
    const { $from } = view.state.selection
    let id: unknown
    for (let depth = $from.depth; depth > 0 && typeof id !== "string"; depth -= 1)
      id = $from.node(depth).attrs["id"]
    if (typeof id !== "string") id = ($from.nodeAfter ?? $from.nodeBefore)?.attrs["id"]
    if (typeof id !== "string") return
    const element = options.ownedBlockById(id)
    if (element !== null) options.show(element)
  }

export const attachRailPointerIntent = (
  view: EditorView,
  options: RailPointerOptions,
): (() => void) => {
  const ownerWindow = view.dom.ownerDocument.defaultView
  let dwellTimer = 0
  const onPointerOver = (event: PointerEvent) => {
    const block = blockElement(event.target)
    if (block === null || !options.ownsBlock(block)) return
    const candidateId = block.dataset["blockId"]
    const targetId = options.targetId()
    if (targetId === null || options.rail.hidden) {
      options.show(block)
      return
    }
    if (candidateId === undefined || candidateId === targetId) {
      ownerWindow?.clearTimeout(dwellTimer)
      if (candidateId !== undefined) options.show(block)
      return
    }
    const activeRect = options.activeRect()
    if (
      activeRect !== null &&
      insideRailCorridor(
        { x: event.clientX, y: event.clientY },
        { block: activeRect, rail: options.rail.getBoundingClientRect() },
      )
    )
      return
    ownerWindow?.clearTimeout(dwellTimer)
    dwellTimer =
      ownerWindow?.setTimeout(() => {
        const current = blockElement(
          view.dom.ownerDocument.elementFromPoint(event.clientX, event.clientY),
        )
        if (
          current !== null &&
          current.dataset["blockId"] === candidateId &&
          options.ownsBlock(current)
        )
          options.show(current)
      }, 160) ?? 0
  }
  view.dom.addEventListener("pointerover", onPointerOver)
  return () => {
    view.dom.removeEventListener("pointerover", onPointerOver)
    ownerWindow?.clearTimeout(dwellTimer)
  }
}

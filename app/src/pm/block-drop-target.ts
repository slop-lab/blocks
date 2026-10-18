import type { BlockDropTarget } from "./block-drop-commands"

type PointerPoint = { readonly x: number; readonly y: number }

type BlockDropPlannerOptions = {
  readonly root: HTMLElement
  readonly ownerDocument: Document
  readonly edgeSize: number
  readonly rootChildCount: number
  readonly blockIndex: (blockId: string) => number
  readonly childCount: (blockId: string) => number
  readonly canMove: (blockIds: readonly string[], target: BlockDropTarget) => boolean
}

export type BlockDropPlan = {
  readonly target: BlockDropTarget
  readonly rect: DOMRect
  readonly atStart: boolean
  readonly inset: number
}

export const planBlockDrop = (
  options: BlockDropPlannerOptions,
  blockIds: readonly string[],
  point: PointerPoint,
): BlockDropPlan | null => {
  const hit = options.ownerDocument.elementFromPoint(point.x, point.y)
  const target = hit?.closest("[data-block-id]") ?? null
  if (target !== null && !options.root.contains(target)) return null
  if (target instanceof HTMLElement) {
    const id = target.dataset["blockId"]
    if (id === undefined) return null
    const index = options.blockIndex(id)
    if (index < 0) return null
    const rect = target.getBoundingClientRect()
    const inset = Math.min(options.edgeSize, rect.width / 4)
    if (point.x > rect.left + inset) {
      for (
        let container: HTMLElement | null = target;
        container !== null && options.root.contains(container);
        container = container.parentElement?.closest<HTMLElement>("[data-block-id]") ?? null
      ) {
        const parentId = container.dataset["blockId"]
        if (parentId === undefined) continue
        const candidate = { parentId, index: options.childCount(parentId) }
        if (!options.canMove(blockIds, candidate)) continue
        const containerRect = container.getBoundingClientRect()
        return {
          target: candidate,
          rect: containerRect,
          atStart: false,
          inset: Math.min(options.edgeSize, containerRect.width / 4),
        }
      }
    }
    const atStart = point.y < rect.top + rect.height / 2
    const parent = target.parentElement?.closest<HTMLElement>("[data-block-id]")
    const candidate = {
      parentId: parent?.dataset["blockId"] ?? null,
      index: atStart ? index : index + 1,
    }
    return options.canMove(blockIds, candidate)
      ? { target: candidate, rect, atStart, inset: 0 }
      : null
  }
  const blocks = [...options.root.children].filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && element.hasAttribute("data-block-id"),
  )
  const first = blocks[0] ?? null
  const last = blocks.at(-1) ?? null
  const editorRect = options.root.getBoundingClientRect()
  if (first === null || last === null || point.x < editorRect.left || point.x > editorRect.right)
    return null
  if (point.y < first.getBoundingClientRect().top) {
    const candidate = { parentId: null, index: 0 }
    return options.canMove(blockIds, candidate)
      ? { target: candidate, rect: first.getBoundingClientRect(), atStart: true, inset: 0 }
      : null
  }
  if (point.y > last.getBoundingClientRect().bottom) {
    const candidate = { parentId: null, index: options.rootChildCount }
    return options.canMove(blockIds, candidate)
      ? { target: candidate, rect: last.getBoundingClientRect(), atStart: false, inset: 0 }
      : null
  }
  return null
}

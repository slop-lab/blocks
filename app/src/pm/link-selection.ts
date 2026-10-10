import type { MarkType, Node as ProseMirrorNode } from "prosemirror-model"
import { type EditorState, NodeSelection } from "prosemirror-state"

export type LinkTarget = {
  readonly document: ProseMirrorNode
  readonly from: number
  readonly to: number
  readonly blockIds: readonly string[]
  readonly href: string
}

const blockIdsForRange = (
  document: ProseMirrorNode,
  from: number,
  to: number,
): readonly string[] | null => {
  const blockIds: string[] = []
  let complete = true
  document.forEach((node, position) => {
    if (from >= position + node.nodeSize || to <= position) return
    const blockId = node.attrs["id"]
    if (typeof blockId === "string") blockIds.push(blockId)
    else complete = false
  })
  return complete && blockIds.length > 0 ? blockIds : null
}

const commonLinkHref = (
  document: ProseMirrorNode,
  from: number,
  to: number,
  linkMark: MarkType,
): string => {
  let href: string | undefined
  let uniform = true
  document.nodesBetween(from, to, (node) => {
    if (!node.isText) return
    const mark = linkMark.isInSet(node.marks)
    const candidate = mark?.attrs["href"]
    if (typeof candidate !== "string" || (href !== undefined && href !== candidate)) uniform = false
    else href = candidate
  })
  return uniform ? (href ?? "") : ""
}

export const captureLinkTarget = (state: EditorState, linkMark: MarkType): LinkTarget | null => {
  const { selection } = state
  if (selection.empty || selection instanceof NodeSelection) return null
  const blockIds = blockIdsForRange(state.doc, selection.from, selection.to)
  if (blockIds === null) return null
  return {
    document: state.doc,
    from: selection.from,
    to: selection.to,
    blockIds,
    href: commonLinkHref(state.doc, selection.from, selection.to, linkMark),
  }
}

export const isCurrentLinkTarget = (state: EditorState, target: LinkTarget): boolean => {
  if (
    state.doc !== target.document ||
    state.selection.from !== target.from ||
    state.selection.to !== target.to
  )
    return false
  const currentIds = blockIdsForRange(state.doc, target.from, target.to)
  return (
    currentIds !== null &&
    currentIds.length === target.blockIds.length &&
    currentIds.every((blockId, index) => blockId === target.blockIds[index])
  )
}

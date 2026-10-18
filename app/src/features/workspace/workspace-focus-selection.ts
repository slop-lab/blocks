import type { Node as ProseMirrorNode } from "prosemirror-model"
import type { Selection } from "prosemirror-state"
import type { WorkspaceFocusTarget } from "./workspace-focus-navigation"

type NodeRange = {
  readonly from: number
  readonly to: number
}

export type WorkspaceFocusChange = {
  readonly target: WorkspaceFocusTarget
  readonly ancestorBlockIds: readonly string[]
}

const blockRange = (document: ProseMirrorNode, blockId: string): NodeRange | null => {
  let result: NodeRange | null = null
  document.descendants((node, position) => {
    if (node.attrs["id"] === blockId) {
      result = { from: position, to: position + node.nodeSize }
      return false
    }
    return result === null
  })
  return result
}

const selectedBlockPath = (selection: Selection): readonly string[] => {
  const path: string[] = []
  for (let depth = selection.$head.depth; depth > 0; depth -= 1) {
    const id = selection.$head.node(depth).attrs["id"]
    if (typeof id === "string" && id.length > 0) path.unshift(id)
  }
  return path
}

export const focusTargetAfterDocumentChange = (
  document: ProseMirrorNode,
  selection: Selection,
  target: WorkspaceFocusTarget | null,
): WorkspaceFocusChange | null => {
  if (target === null) return null
  const focused = blockRange(document, target.blockId)
  if (focused === null || (focused.from <= selection.from && selection.to <= focused.to))
    return null
  const ancestorBlockIds = selectedBlockPath(selection)
  const blockId = ancestorBlockIds.at(-1)
  return blockId === undefined || blockId === target.blockId
    ? null
    : { target: { ...target, blockId }, ancestorBlockIds }
}

import { Fragment, type Node as ProseMirrorNode } from "prosemirror-model"
import type { Command } from "prosemirror-state"
import { TextSelection } from "prosemirror-state"
import { type LocatedBlock, locateBlock, moveBlocksById } from "./block-structure-commands"

export type BlockDropTarget = {
  readonly parentId: string | null
  readonly index: number
}

const gapPosition = (parent: ProseMirrorNode, parentStart: number, gapIndex: number): number => {
  let position = parentStart
  for (let index = 0; index < Math.min(gapIndex, parent.childCount); index += 1)
    position += parent.child(index).nodeSize
  return position
}

const hasLockedNode = (node: ProseMirrorNode): boolean => {
  if (node.attrs["locked"] === true) return true
  let locked = false
  node.descendants((child) => {
    if (child.attrs["locked"] !== true) return true
    locked = true
    return false
  })
  return locked
}

const hasLockedAncestor = (document: ProseMirrorNode, position: number): boolean => {
  const resolved = document.resolve(position)
  for (let depth = resolved.depth; depth > 0; depth -= 1)
    if (resolved.node(depth).attrs["locked"] === true) return true
  return false
}

const siblingSources = (
  document: ProseMirrorNode,
  blockIds: readonly string[],
): readonly LocatedBlock[] | null => {
  const uniqueIds = [...new Set(blockIds)]
  const sources = uniqueIds
    .map((blockId) => locateBlock(document, blockId))
    .filter((block): block is LocatedBlock => block !== null)
    .sort((left, right) => left.position - right.position)
  const first = sources[0]
  return first !== undefined &&
    sources.length === uniqueIds.length &&
    sources.every(
      (source) => source.parentStart === first.parentStart && !hasLockedNode(source.node),
    )
    ? sources
    : null
}

export const moveBlocksToById =
  (blockIds: readonly string[], target: BlockDropTarget): Command =>
  (state, dispatch) => {
    const sources = siblingSources(state.doc, blockIds)
    const first = sources?.[0]
    const targetBlock = target.parentId === null ? null : locateBlock(state.doc, target.parentId)
    const targetParent = targetBlock?.node ?? state.doc
    const targetStart = targetBlock === null ? 0 : targetBlock.position + 1
    if (
      sources === null ||
      first === undefined ||
      (target.parentId !== null && targetBlock === null) ||
      target.index < 0 ||
      target.index > targetParent.childCount ||
      hasLockedAncestor(state.doc, first.position) ||
      (targetBlock !== null &&
        (targetBlock.node.attrs["locked"] === true ||
          hasLockedAncestor(state.doc, targetBlock.position))) ||
      sources.some(
        (source) =>
          source.node === targetParent ||
          (targetBlock !== null &&
            targetBlock.position > source.position &&
            targetBlock.position < source.position + source.node.nodeSize),
      )
    )
      return false
    if (targetParent === first.parent)
      return moveBlocksById(blockIds, target.index)(state, dispatch)
    const sourceIndexes = new Set(sources.map((source) => source.index))
    const remainingSource = Fragment.fromArray(
      Array.from({ length: first.parent.childCount }, (_, index) =>
        first.parent.child(index),
      ).filter((_node, index) => !sourceIndexes.has(index)),
    )
    const inserted = Fragment.fromArray(sources.map((source) => source.node))
    if (
      !first.parent.type.validContent(remainingSource) ||
      !targetParent.canReplace(target.index, target.index, inserted)
    )
      return false
    if (dispatch !== undefined) {
      const originalInsertion = gapPosition(targetParent, targetStart, target.index)
      let transaction = state.tr
      for (const source of [...sources].reverse())
        transaction = transaction.delete(source.position, source.position + source.node.nodeSize)
      const insertion = transaction.mapping.map(originalInsertion, -1)
      transaction = transaction.insert(insertion, inserted)
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(insertion + 1)))
      dispatch(transaction.setMeta("origin", "local").scrollIntoView())
    }
    return true
  }

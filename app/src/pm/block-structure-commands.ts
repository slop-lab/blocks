import { Fragment, type Node as ProseMirrorNode } from "prosemirror-model"
import type { Command } from "prosemirror-state"
import { TextSelection } from "prosemirror-state"

export type LocatedBlock = {
  readonly depth: number
  readonly index: number
  readonly parentPosition: number
  readonly position: number
  readonly node: ProseMirrorNode
  readonly parent: ProseMirrorNode
  readonly parentStart: number
}

export const locateBlock = (document: ProseMirrorNode, blockId: string): LocatedBlock | null => {
  let found: LocatedBlock | null = null
  document.descendants((node, position) => {
    if (found !== null || node.attrs["id"] !== blockId) return found === null
    const resolved = document.resolve(position)
    found = {
      depth: resolved.depth,
      index: resolved.index(),
      parentPosition: resolved.depth === 0 ? -1 : resolved.before(resolved.depth),
      position,
      node,
      parent: resolved.parent,
      parentStart: resolved.start(resolved.depth),
    }
    return false
  })
  return found
}

const gapPosition = (parent: ProseMirrorNode, parentStart: number, gapIndex: number): number => {
  let position = parentStart
  for (let index = 0; index < Math.min(gapIndex, parent.childCount); index += 1)
    position += parent.child(index).nodeSize
  return position
}

export const moveBlockById =
  (blockId: string, targetGap: number): Command =>
  (state, dispatch) => {
    const source = locateBlock(state.doc, blockId)
    if (
      source === null ||
      source.node.attrs["locked"] === true ||
      targetGap < 0 ||
      targetGap > source.parent.childCount ||
      targetGap === source.index ||
      targetGap === source.index + 1
    )
      return false
    if (dispatch !== undefined) {
      const originalInsertion = gapPosition(source.parent, source.parentStart, targetGap)
      const insertion =
        originalInsertion > source.position
          ? originalInsertion - source.node.nodeSize
          : originalInsertion
      const transaction = state.tr
        .delete(source.position, source.position + source.node.nodeSize)
        .insert(insertion, source.node)
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(insertion + 1)))
      dispatch(transaction.setMeta("origin", "local").scrollIntoView())
    }
    return true
  }

export const moveBlocksById =
  (blockIds: readonly string[], targetGap: number): Command =>
  (state, dispatch) => {
    const uniqueIds = [...new Set(blockIds)]
    const sources = uniqueIds
      .map((blockId) => locateBlock(state.doc, blockId))
      .filter((block): block is LocatedBlock => block !== null)
      .sort((left, right) => left.position - right.position)
    const first = sources[0]
    if (
      first === undefined ||
      sources.length !== uniqueIds.length ||
      sources.some(
        (source) =>
          source.parentStart !== first.parentStart || source.node.attrs["locked"] === true,
      ) ||
      targetGap < 0 ||
      targetGap > first.parent.childCount
    )
      return false
    const sourceIndexes = new Set(sources.map((source) => source.index))
    const remaining = Array.from({ length: first.parent.childCount }, (_, index) => index).filter(
      (index) => !sourceIndexes.has(index),
    )
    const adjustedGap = Math.max(
      0,
      Math.min(
        remaining.length,
        targetGap - sources.filter((source) => source.index < targetGap).length,
      ),
    )
    const reordered = [
      ...remaining.slice(0, adjustedGap),
      ...sources.map((source) => source.index),
      ...remaining.slice(adjustedGap),
    ]
    if (reordered.every((index, currentIndex) => index === currentIndex)) return false
    if (dispatch !== undefined) {
      const originalInsertion = gapPosition(first.parent, first.parentStart, targetGap)
      const insertion =
        originalInsertion -
        sources
          .filter((source) => source.position < originalInsertion)
          .reduce((size, source) => size + source.node.nodeSize, 0)
      let transaction = state.tr
      for (const source of [...sources].reverse())
        transaction = transaction.delete(source.position, source.position + source.node.nodeSize)
      transaction = transaction.insert(
        insertion,
        Fragment.fromArray(sources.map((source) => source.node)),
      )
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(insertion + 1)))
      dispatch(transaction.setMeta("origin", "local").scrollIntoView())
    }
    return true
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

export const indentBlocksById =
  (blockIds: readonly string[]): Command =>
  (state, dispatch) => {
    const sources = siblingSources(state.doc, blockIds)
    const first = sources?.[0]
    if (sources === null || first === undefined || first.index === 0 || hasLockedNode(first.parent))
      return false
    const previousIndex = first.index - 1
    const previous = first.parent.child(previousIndex)
    const previousPosition = gapPosition(first.parent, first.parentStart, previousIndex)
    const inserted = Fragment.fromArray(sources.map((source) => source.node))
    if (hasLockedNode(previous) || !previous.type.validContent(previous.content.append(inserted)))
      return false
    if (dispatch !== undefined) {
      let transaction = state.tr
      for (const source of [...sources].reverse())
        transaction = transaction.delete(source.position, source.position + source.node.nodeSize)
      const insertion = previousPosition + previous.nodeSize - 1
      transaction = transaction.insert(insertion, inserted)
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(insertion + 1)))
      dispatch(transaction.setMeta("origin", "local").scrollIntoView())
    }
    return true
  }

export const outdentBlocksById =
  (blockIds: readonly string[]): Command =>
  (state, dispatch) => {
    const sources = siblingSources(state.doc, blockIds)
    const first = sources?.[0]
    if (
      sources === null ||
      first === undefined ||
      first.depth === 0 ||
      first.parentPosition < 0 ||
      hasLockedNode(first.parent)
    )
      return false
    const parentResolved = state.doc.resolve(first.parentPosition)
    const grandparent = parentResolved.parent
    const parentIndex = parentResolved.index()
    const sourceIndexes = new Set(sources.map((source) => source.index))
    const remaining = Fragment.fromArray(
      Array.from({ length: first.parent.childCount }, (_, index) =>
        first.parent.child(index),
      ).filter((_node, index) => !sourceIndexes.has(index)),
    )
    const inserted = Fragment.fromArray(sources.map((source) => source.node))
    if (
      !first.parent.type.validContent(remaining) ||
      !grandparent.canReplace(parentIndex + 1, parentIndex + 1, inserted)
    )
      return false
    if (dispatch !== undefined) {
      const originalInsertion = first.parentPosition + first.parent.nodeSize
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

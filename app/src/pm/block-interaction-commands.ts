import type { NodeType, Node as ProseMirrorNode } from "prosemirror-model"
import type { Command, EditorState } from "prosemirror-state"
import { TextSelection } from "prosemirror-state"

export { safeLinkHref } from "../core/links"

export type SlashQuery = {
  readonly from: number
  readonly to: number
  readonly query: string
  readonly blockId: string
}

type LocatedBlock = {
  readonly index: number
  readonly position: number
  readonly node: ProseMirrorNode
}

const locateBlock = (document: ProseMirrorNode, blockId: string): LocatedBlock | null => {
  let found: LocatedBlock | null = null
  document.forEach((node, position, index) => {
    if (found === null && node.attrs["id"] === blockId) found = { index, position, node }
  })
  return found
}

export const blockPositionById = (document: ProseMirrorNode, blockId: string): number =>
  locateBlock(document, blockId)?.position ?? -1

const gapPosition = (document: ProseMirrorNode, gapIndex: number): number => {
  let position = 0
  for (let index = 0; index < Math.min(gapIndex, document.childCount); index += 1) {
    position += document.child(index).nodeSize
  }
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
      targetGap > state.doc.childCount ||
      targetGap === source.index ||
      targetGap === source.index + 1
    )
      return false
    if (dispatch !== undefined) {
      const originalInsertion = gapPosition(state.doc, targetGap)
      const insertion =
        originalInsertion > source.position
          ? originalInsertion - source.node.nodeSize
          : originalInsertion
      const transaction = state.tr
        .delete(source.position, source.position + source.node.nodeSize)
        .insert(insertion, source.node)
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(insertion + 1)))
      transaction.setMeta("origin", "local")
      dispatch(transaction.scrollIntoView())
    }
    return true
  }

export const createBlockAfter =
  (blockId: string, type?: NodeType): Command =>
  (state, dispatch) => {
    const target = locateBlock(state.doc, blockId)
    const paragraph = type ?? state.schema.nodes["paragraph"]
    if (target === null || target.node.attrs["locked"] === true || paragraph === undefined)
      return false
    if (dispatch !== undefined) {
      const node = paragraph.create({ id: crypto.randomUUID(), locked: false })
      const position = target.position + target.node.nodeSize
      const transaction = state.tr.insert(position, node)
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(position + 1)))
      dispatch(transaction.setMeta("origin", "local").scrollIntoView())
    }
    return true
  }

export const duplicateBlockById =
  (blockId: string): Command =>
  (state, dispatch) => {
    const target = locateBlock(state.doc, blockId)
    if (target === null || target.node.attrs["locked"] === true) return false
    if (dispatch !== undefined) {
      const duplicate = target.node.type.create(
        { ...target.node.attrs, id: crypto.randomUUID(), locked: false },
        target.node.content,
        target.node.marks,
      )
      dispatch(
        state.tr
          .insert(target.position + target.node.nodeSize, duplicate)
          .setMeta("origin", "local")
          .scrollIntoView(),
      )
    }
    return true
  }

export const deleteBlockById =
  (blockId: string): Command =>
  (state, dispatch) => {
    const target = locateBlock(state.doc, blockId)
    if (target === null || target.node.attrs["locked"] === true || state.doc.childCount === 1)
      return false
    dispatch?.(
      state.tr
        .delete(target.position, target.position + target.node.nodeSize)
        .setMeta("origin", "local")
        .scrollIntoView(),
    )
    return true
  }

export const setBlockTypeById =
  (blockId: string, type: NodeType, attrs: Readonly<Record<string, unknown>> = {}): Command =>
  (state, dispatch) => {
    const target = locateBlock(state.doc, blockId)
    if (
      target === null ||
      target.node.attrs["locked"] === true ||
      !type.isTextblock ||
      !type.validContent(target.node.content)
    )
      return false
    dispatch?.(
      state.tr
        .setNodeMarkup(target.position, type, { ...target.node.attrs, ...attrs })
        .setMeta("origin", "local")
        .scrollIntoView(),
    )
    return true
  }

export const parseSlashQuery = (state: EditorState, composing = false): SlashQuery | null => {
  const { $from, empty } = state.selection
  if (composing || !empty || $from.depth === 0) return null
  const block = $from.node(1)
  if (
    !block.isTextblock ||
    block.type.spec.code === true ||
    block.type.name === "caption" ||
    block.attrs["locked"] === true
  )
    return null
  const before = block.textBetween(0, $from.parentOffset, "\n", "\ufffc")
  const match = /^\/([^\s/]*)$/u.exec(before)
  const blockId = block.attrs["id"]
  if (match === null || typeof blockId !== "string" || match[1] === undefined) return null
  return { from: $from.start(), to: $from.pos, query: match[1], blockId }
}

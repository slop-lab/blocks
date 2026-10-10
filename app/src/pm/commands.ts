import { toggleMark } from "prosemirror-commands"
import type { NodeType } from "prosemirror-model"
import type { Command, EditorState, Transaction } from "prosemirror-state"
import { NodeSelection, TextSelection } from "prosemirror-state"
import { defaultNodeForState } from "./profile-plugin"

const withBlock = (
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  action: (position: number, nodeSize: number) => Transaction,
): boolean => {
  const position =
    state.selection instanceof NodeSelection
      ? state.selection.from
      : state.selection.$from.depth === 0
        ? 0
        : state.selection.$from.before(1)
  const node = state.doc.nodeAt(position)
  if (node === null || node.attrs["locked"] === true) return false
  if (dispatch !== undefined) dispatch(action(position, node.nodeSize).scrollIntoView())
  return true
}

export const insertBlock =
  (type?: NodeType): Command =>
  (state, dispatch) => {
    const resolved = type ?? defaultNodeForState(state)
    if (resolved === undefined) return false
    const node = resolved.create({ id: crypto.randomUUID(), locked: false })
    if (dispatch !== undefined) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView())
    return true
  }

export const deleteBlock: Command = (state, dispatch) =>
  withBlock(state, dispatch, (position, nodeSize) => state.tr.delete(position, position + nodeSize))

export const duplicateBlock: Command = (state, dispatch) =>
  withBlock(state, dispatch, (position, nodeSize) => {
    const node = state.doc.nodeAt(position)
    if (node === null) return state.tr
    const duplicate = node.type.create(
      { ...node.attrs, id: crypto.randomUUID(), locked: false },
      node.content,
      node.marks,
    )
    return state.tr.insert(position + nodeSize, duplicate)
  })

export const moveBlock =
  (direction: -1 | 1): Command =>
  (state, dispatch) =>
    withBlock(state, dispatch, (position, nodeSize) => {
      const node = state.doc.nodeAt(position)
      if (node === null) return state.tr
      const target =
        direction < 0
          ? state.doc.resolve(position).nodeBefore
          : state.doc.resolve(position + nodeSize).nodeAfter
      if (target === null || target.attrs["locked"] === true) return state.tr
      const targetPosition =
        direction < 0 ? position - target.nodeSize : position + nodeSize + target.nodeSize
      const tr = state.tr.delete(position, position + nodeSize)
      const insertion = direction < 0 ? position - target.nodeSize : position + target.nodeSize
      tr.insert(insertion, node)
      return tr.setSelection(
        TextSelection.near(tr.doc.resolve(Math.min(targetPosition, tr.doc.content.size))),
      )
    })

export const setType = (
  name: string,
  attrs?: Readonly<Record<string, unknown>>,
): Command => {
  return (state, dispatch) =>
    withBlock(state, dispatch, (position) => {
      const type = state.schema.nodes[name]
      if (type === undefined) return state.tr
      const node = state.doc.nodeAt(position)
      if (node === null || !type.validContent(node.content)) return state.tr
      return state.tr.setNodeMarkup(position, type, { ...node.attrs, ...attrs })
    })
}

export const toggleFormat = (name: "strong" | "em" | "code"): Command => {
  return (state, dispatch) => {
    const mark = state.schema.marks[name]
    return mark === undefined ? false : toggleMark(mark)(state, dispatch)
  }
}

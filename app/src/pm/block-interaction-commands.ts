import { Fragment, type NodeType, type Node as ProseMirrorNode } from "prosemirror-model"
import type { Command, EditorState } from "prosemirror-state"
import { TextSelection } from "prosemirror-state"
import { locateBlock } from "./block-structure-commands"
import { defaultNodeForState } from "./profile-plugin"

export { safeLinkHref } from "../core/links"
export {
  indentBlocksById,
  moveBlockById,
  moveBlocksById,
  outdentBlocksById,
} from "./block-structure-commands"

export type SlashQuery = {
  readonly from: number
  readonly to: number
  readonly query: string
  readonly blockId: string
}

export type BlockCreation = {
  readonly type: NodeType
  readonly attrs: Readonly<Record<string, unknown>>
  readonly container?: "titled" | "body"
}

const freshIdentity = (node: ProseMirrorNode): ProseMirrorNode => {
  if (node.isText) return node
  const children: ProseMirrorNode[] = []
  node.forEach((child) => {
    children.push(freshIdentity(child))
  })
  const id = node.attrs["id"]
  return node.type.create(
    typeof id === "string" ? { ...node.attrs, id: crypto.randomUUID(), locked: false } : node.attrs,
    children.length === 0 ? undefined : Fragment.fromArray(children),
    node.marks,
  )
}

export const blockPositionById = (document: ProseMirrorNode, blockId: string): number =>
  locateBlock(document, blockId)?.position ?? -1

export const blockIndexById = (document: ProseMirrorNode, blockId: string): number =>
  locateBlock(document, blockId)?.index ?? -1

export const blockNodeById = (document: ProseMirrorNode, blockId: string): ProseMirrorNode | null =>
  locateBlock(document, blockId)?.node ?? null

export const blockSiblingCountById = (document: ProseMirrorNode, blockId: string): number =>
  locateBlock(document, blockId)?.parent.childCount ?? 0

export const createBlockAfter =
  (blockId: string, creation?: BlockCreation): Command =>
  (state, dispatch) => {
    const target = locateBlock(state.doc, blockId)
    const defaultText = creation?.type ?? defaultNodeForState(state)
    if (target === null || target.node.attrs["locked"] === true || defaultText === undefined)
      return false
    if (dispatch !== undefined) {
      const attrs = { id: crypto.randomUUID(), locked: false, ...creation?.attrs }
      const defaultChild = defaultNodeForState(state)?.create({
        id: crypto.randomUUID(),
        locked: false,
      })
      const created =
        creation?.container === undefined
          ? defaultText.createAndFill(attrs)
          : defaultText.createAndFill(attrs, defaultChild)
      if (created === null) return false
      const node = freshIdentity(created)
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
      const identities = new Map<string, string>()
      target.node.descendants((node) => {
        const id = node.attrs["id"]
        if (typeof id === "string") identities.set(id, crypto.randomUUID())
        return true
      })
      const rootId = target.node.attrs["id"]
      if (typeof rootId === "string") identities.set(rootId, crypto.randomUUID())
      const clone = (node: ProseMirrorNode): ProseMirrorNode => {
        if (node.isText) return node
        const attrs: Record<string, unknown> = { ...node.attrs, locked: false }
        for (const [name, value] of Object.entries(attrs))
          if (typeof value === "string" && identities.has(value))
            attrs[name] = identities.get(value)
        if (node === target.node && typeof attrs["occurrenceId"] === "string")
          attrs["occurrenceId"] = crypto.randomUUID()
        const children: ProseMirrorNode[] = []
        node.content.forEach((child) => {
          children.push(clone(child))
        })
        return node.type.create(
          attrs,
          children.length === 0 ? undefined : Fragment.fromArray(children),
          node.marks,
        )
      }
      const duplicate = clone(target.node)
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
  const block = $from.parent
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

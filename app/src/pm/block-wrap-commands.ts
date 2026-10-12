import { planTreeWrap, type TreeNode, type TreeWrapPlan } from "@block-editor/containers"
import { Fragment, type NodeType, type Node as ProseMirrorNode } from "prosemirror-model"
import type { Command } from "prosemirror-state"
import { TextSelection } from "prosemirror-state"
import { locateBlock } from "./block-structure-commands"

const blockChildren = (node: ProseMirrorNode): readonly ProseMirrorNode[] => {
  const children: ProseMirrorNode[] = []
  node.forEach((child) => {
    if (child.type.isInGroup("block")) children.push(child)
  })
  return children
}

const treeNode = (node: ProseMirrorNode): TreeNode | null => {
  const id = node.attrs["id"]
  if (typeof id !== "string" || id.length === 0) return null
  return {
    id,
    locked: node.attrs["locked"] === true,
    children: blockChildren(node).flatMap((child) => {
      const converted = treeNode(child)
      return converted === null ? [] : [converted]
    }),
  }
}

const documentForest = (document: ProseMirrorNode): readonly TreeNode[] =>
  blockChildren(document).flatMap((node) => {
    const converted = treeNode(node)
    return converted === null ? [] : [converted]
  })

export const planBlockWrap = (
  document: ProseMirrorNode,
  blockIds: readonly string[],
): TreeWrapPlan => planTreeWrap(documentForest(document), blockIds)

export const wrapBlocksById =
  (
    blockIds: readonly string[],
    containerType: NodeType,
    wrapperId = crypto.randomUUID(),
  ): Command =>
  (state, dispatch) => {
    const plan = planBlockWrap(state.doc, blockIds)
    if (plan.kind !== "exact") return false
    const sources = plan.rootIds.flatMap((id) => {
      const source = locateBlock(state.doc, id)
      return source === null ? [] : [source]
    })
    const first = sources[0]
    const last = sources.at(-1)
    if (
      first === undefined ||
      last === undefined ||
      sources.length !== plan.rootIds.length ||
      sources.some((source) => source.parentStart !== first.parentStart)
    )
      return false
    const content = Fragment.fromArray(sources.map(({ node }) => node))
    const wrapper = containerType.createAndFill({ id: wrapperId, locked: false }, content)
    if (wrapper === null) return false
    if (dispatch !== undefined) {
      const transaction = state.tr.replaceWith(
        first.position,
        last.position + last.node.nodeSize,
        wrapper,
      )
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(first.position + 1)))
      dispatch(transaction.setMeta("origin", "local").scrollIntoView())
    }
    return true
  }

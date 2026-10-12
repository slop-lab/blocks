import { Fragment, type Node as ProseMirrorNode } from "prosemirror-model"
import type { EditorView } from "prosemirror-view"

type SelectionReader = { readonly value: readonly string[] }

export type LocatedBlockNode = {
  readonly id: string
  readonly node: ProseMirrorNode
  readonly position: number
}

export type InsertionBookmark = {
  readonly document: ProseMirrorNode
  readonly position: number
}

export const resolveInsertionBookmark = (
  document: ProseMirrorNode,
  bookmark: InsertionBookmark | null,
): number | null => (bookmark?.document === document ? bookmark.position : null)

export const locatedBlockNodes = (document: ProseMirrorNode): readonly LocatedBlockNode[] => {
  const result: LocatedBlockNode[] = []
  document.descendants((node, position) => {
    const id = node.attrs["id"]
    if (typeof id === "string" && id.length > 0) result.push({ id, node, position })
    return true
  })
  return result
}

export const selectedBlockNodes = (
  document: ProseMirrorNode,
  requested: readonly string[],
): readonly LocatedBlockNode[] => {
  const selected = new Set(requested)
  const result: LocatedBlockNode[] = []
  const visit = (
    parent: ProseMirrorNode,
    basePosition: number,
    ancestorSelected: boolean,
  ): void => {
    parent.forEach((node, offset) => {
      const position = basePosition + offset
      const id = node.attrs["id"]
      const include = typeof id === "string" && selected.has(id) && !ancestorSelected
      if (include) result.push({ id, node, position })
      visit(node, position + 1, ancestorSelected || include)
    })
  }
  visit(document, 0, false)
  return result
}

export const selectedBlockIdsInDocumentOrder = (
  view: EditorView,
  selection: SelectionReader,
): readonly string[] => selectedBlockNodes(view.state.doc, selection.value).map(({ id }) => id)

export const selectionContainsLockedNode = (
  document: ProseMirrorNode,
  requested: readonly string[],
): boolean => {
  const selected = new Set(selectedBlockNodes(document, requested).map(({ id }) => id))
  let locked = false
  const visit = (
    parent: ProseMirrorNode,
    ancestorSelected: boolean,
    ancestorLocked: boolean,
  ): void => {
    parent.forEach((node) => {
      const id = node.attrs["id"]
      const currentSelected = ancestorSelected || (typeof id === "string" && selected.has(id))
      const currentLocked = ancestorLocked || node.attrs["locked"] === true
      if (currentSelected && currentLocked) locked = true
      visit(node, currentSelected, currentLocked)
    })
  }
  visit(document, false, false)
  return locked
}

export const insertionPositionAtCaret = (view: EditorView): number => {
  const { $from } = view.state.selection
  const adjacent = $from.nodeAfter
  if (adjacent !== null && typeof adjacent.attrs["id"] === "string")
    return $from.pos + adjacent.nodeSize
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if (typeof $from.node(depth).attrs["id"] === "string") return $from.after(depth)
  }
  return $from.pos
}

export const cloneBlockNode = (
  node: ProseMirrorNode,
  identities: ReadonlyMap<string, string>,
  referenceAttrsForNode: (node: ProseMirrorNode) => readonly string[] = () => [],
): ProseMirrorNode => {
  if (node.isText) return node
  const attrs: Record<string, unknown> = { ...node.attrs }
  for (const name of referenceAttrsForNode(node)) {
    const value = node.attrs[name]
    if (typeof value !== "string") continue
    const mapped = identities.get(value)
    if (mapped !== undefined) attrs[name] = mapped
  }
  const id = node.attrs["id"]
  if (typeof id === "string") attrs["id"] = identities.get(id) ?? crypto.randomUUID()
  const children: ProseMirrorNode[] = []
  node.content.forEach((child) => {
    children.push(cloneBlockNode(child, identities, referenceAttrsForNode))
  })
  return node.type.create(
    attrs,
    children.length === 0 ? undefined : Fragment.fromArray(children),
    node.marks,
  )
}

export const externalReferencesForNodes = (
  nodes: readonly ProseMirrorNode[],
  referenceAttrsForNode: (node: ProseMirrorNode) => readonly string[],
): readonly string[] => {
  const local = new Set<string>()
  const references = new Set<string>()
  const visit = (node: ProseMirrorNode) => {
    const id = node.attrs["id"]
    if (typeof id === "string") local.add(id)
    node.forEach(visit)
  }
  for (const node of nodes) visit(node)
  const collect = (node: ProseMirrorNode) => {
    for (const name of referenceAttrsForNode(node)) {
      const value = node.attrs[name]
      if (typeof value === "string" && value.length > 0 && !local.has(value)) references.add(value)
    }
    node.forEach(collect)
  }
  for (const node of nodes) collect(node)
  return [...references]
}

export type TreeNode = Readonly<Record<string, unknown>> & {
  readonly id: string
  readonly children: readonly TreeNode[]
  readonly locked?: boolean
  readonly boundary?: string
}

export type FlatTreeNode = {
  readonly node: TreeNode
  readonly depth: number
  readonly parentId: string | null
  readonly index: number
}

export type MoveTarget = { readonly parentId: string | null; readonly index: number }
export type MoveResult =
  | { readonly kind: "moved"; readonly forest: readonly TreeNode[] }
  | {
      readonly kind: "rejected"
      readonly reason: "descendant-target" | "locked" | "mixed-boundary" | "missing-target"
    }

export const flattenTree = (forest: readonly TreeNode[]): readonly FlatTreeNode[] => {
  const flattened: FlatTreeNode[] = []
  const visit = (nodes: readonly TreeNode[], parentId: string | null, depth: number): void => {
    nodes.forEach((node, index) => {
      flattened.push({ node, depth, parentId, index })
      visit(node.children, node.id, depth + 1)
    })
  }
  visit(forest, null, 0)
  return flattened
}

export const canonicalSelection = (
  forest: readonly TreeNode[],
  requested: readonly string[],
): readonly string[] => {
  const selected = new Set(requested)
  const result: string[] = []
  const visit = (nodes: readonly TreeNode[], ancestorSelected: boolean): void => {
    for (const node of nodes) {
      const include = selected.has(node.id) && !ancestorSelected
      if (include) result.push(node.id)
      visit(node.children, ancestorSelected || include)
    }
  }
  visit(forest, false)
  return result
}

const descendants = (node: TreeNode): ReadonlySet<string> =>
  new Set(flattenTree(node.children).map(({ node: child }) => child.id))

const removeIds = (
  nodes: readonly TreeNode[],
  ids: ReadonlySet<string>,
): { readonly forest: readonly TreeNode[]; readonly removed: readonly TreeNode[] } => {
  const forest: TreeNode[] = []
  const removed: TreeNode[] = []
  for (const node of nodes) {
    if (ids.has(node.id)) {
      removed.push(node)
      continue
    }
    const nested = removeIds(node.children, ids)
    forest.push(nested.forest === node.children ? node : { ...node, children: nested.forest })
    removed.push(...nested.removed)
  }
  return { forest, removed }
}

const insertNodes = (
  nodes: readonly TreeNode[],
  target: MoveTarget,
  inserted: readonly TreeNode[],
): readonly TreeNode[] | null => {
  if (target.parentId === null) {
    if (target.index < 0 || target.index > nodes.length) return null
    return [...nodes.slice(0, target.index), ...inserted, ...nodes.slice(target.index)]
  }
  let matched = false
  const result = nodes.map((node) => {
    if (node.id === target.parentId) {
      if (target.index < 0 || target.index > node.children.length) return node
      matched = true
      return {
        ...node,
        children: [
          ...node.children.slice(0, target.index),
          ...inserted,
          ...node.children.slice(target.index),
        ],
      }
    }
    const children = insertNodes(node.children, target, inserted)
    if (children === null) return node
    matched = true
    return { ...node, children }
  })
  return matched ? result : null
}

export const moveForest = (
  forest: readonly TreeNode[],
  requested: readonly string[],
  target: MoveTarget,
): MoveResult => {
  const ids = canonicalSelection(forest, requested)
  const entries = flattenTree(forest).filter(({ node }) => ids.includes(node.id))
  if (entries.some(({ node }) => node.locked === true))
    return { kind: "rejected", reason: "locked" }
  const boundaries = new Set(entries.map(({ node }) => node.boundary).filter(Boolean))
  if (boundaries.size > 1) return { kind: "rejected", reason: "mixed-boundary" }
  const targetParentId = target.parentId
  if (
    targetParentId !== null &&
    entries.some(({ node }) => node.id === targetParentId || descendants(node).has(targetParentId))
  )
    return { kind: "rejected", reason: "descendant-target" }
  const removed = removeIds(forest, new Set(ids))
  const adjustedTarget =
    target.parentId === null
      ? {
          ...target,
          index:
            target.index -
            entries.filter(({ parentId, index }) => parentId === null && index < target.index)
              .length,
        }
      : target
  const inserted = insertNodes(removed.forest, adjustedTarget, removed.removed)
  return inserted === null
    ? { kind: "rejected", reason: "missing-target" }
    : { kind: "moved", forest: inserted }
}

export const cloneForest = (
  forest: readonly TreeNode[],
  createId: (sourceId: string) => string,
  remap: (node: TreeNode, ids: ReadonlyMap<string, string>) => TreeNode = (node) => node,
): readonly TreeNode[] => {
  const ids = new Map(flattenTree(forest).map(({ node }) => [node.id, createId(node.id)]))
  const clone = (node: TreeNode): TreeNode => {
    const id = ids.get(node.id)
    if (id === undefined) throw new TypeError(`Missing cloned identity for ${node.id}`)
    return remap({ ...node, id, children: node.children.map(clone) }, ids)
  }
  return forest.map(clone)
}

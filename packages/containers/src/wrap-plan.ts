import type { TreeNode } from "./index.js"

export type TreeWrapRange = { readonly from: number; readonly to: number }

export type TreeWrapPlan =
  | {
      readonly kind: "exact" | "expanded"
      readonly selectedIds: readonly string[]
      readonly coveredIds: readonly string[]
      readonly additionalIds: readonly string[]
      readonly parentPath: readonly string[]
      readonly range: TreeWrapRange
      readonly rootIds: readonly string[]
    }
  | {
      readonly kind: "invalid"
      readonly reason:
        | "empty-selection"
        | "missing-id"
        | "duplicate-id"
        | "cycle"
        | "locked"
        | "mixed-boundary"
      readonly ids?: readonly string[]
      readonly boundaries?: readonly string[]
    }

type IndexedNode = {
  readonly node: TreeNode
  readonly path: readonly string[]
  readonly boundary: string | null
}

type TreeIndex = {
  readonly entries: ReadonlyMap<string, IndexedNode>
  readonly invalid: Extract<TreeWrapPlan, { readonly kind: "invalid" }> | null
}

const indexForest = (forest: readonly TreeNode[]): TreeIndex => {
  const entries = new Map<string, IndexedNode>()
  const ancestors = new Set<TreeNode>()
  let invalid: TreeIndex["invalid"] = null
  const visit = (nodes: readonly TreeNode[], path: readonly string[], boundary: string | null) => {
    for (const node of nodes) {
      if (ancestors.has(node)) {
        invalid = { kind: "invalid", reason: "cycle", ids: [node.id] }
        return
      }
      if (entries.has(node.id)) {
        invalid = { kind: "invalid", reason: "duplicate-id", ids: [node.id] }
        return
      }
      const nodeBoundary = node.boundary ?? boundary
      const nodePath = [...path, node.id]
      entries.set(node.id, { node, path: nodePath, boundary: nodeBoundary })
      ancestors.add(node)
      visit(node.children, nodePath, nodeBoundary)
      ancestors.delete(node)
      if (invalid !== null) return
    }
  }
  visit(forest, [], null)
  return { entries, invalid }
}

const subtreeIds = (nodes: readonly TreeNode[]): readonly string[] => {
  const ids: string[] = []
  const visit = (node: TreeNode) => {
    ids.push(node.id)
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return ids
}

const commonParentPath = (entries: readonly IndexedNode[]): readonly string[] => {
  const parentPaths = entries.map(({ path }) => path.slice(0, -1))
  const shortest = Math.min(...parentPaths.map((path) => path.length))
  let length = 0
  while (
    length < shortest &&
    parentPaths.every((path) => path[length] === parentPaths[0]?.[length])
  )
    length += 1
  return parentPaths[0]?.slice(0, length) ?? []
}

const childrenAtPath = (
  forest: readonly TreeNode[],
  parentPath: readonly string[],
): readonly TreeNode[] => {
  let children = forest
  for (const id of parentPath) {
    const parent = children.find((node) => node.id === id)
    if (parent === undefined) return []
    children = parent.children
  }
  return children
}

export const planTreeWrap = (
  forest: readonly TreeNode[],
  requestedIds: readonly string[],
): TreeWrapPlan => {
  if (requestedIds.length === 0) return { kind: "invalid", reason: "empty-selection" }
  const index = indexForest(forest)
  if (index.invalid !== null) return index.invalid
  const missing = [...new Set(requestedIds)].filter((id) => !index.entries.has(id))
  if (missing.length > 0) return { kind: "invalid", reason: "missing-id", ids: missing }
  const requested = new Set(requestedIds)
  const selectedIds = [...index.entries.values()]
    .filter(
      ({ node, path }) =>
        requested.has(node.id) && !path.slice(0, -1).some((id) => requested.has(id)),
    )
    .map(({ node }) => node.id)
  const selectedEntries = selectedIds.flatMap((id) => {
    const entry = index.entries.get(id)
    return entry === undefined ? [] : [entry]
  })
  const parentPath = commonParentPath(selectedEntries)
  const siblings = childrenAtPath(forest, parentPath)
  const branchIds = selectedEntries.map(({ path }) => path[parentPath.length])
  const branchIndexes = branchIds.flatMap((id) => {
    const position = siblings.findIndex((node) => node.id === id)
    return position < 0 ? [] : [position]
  })
  const from = Math.min(...branchIndexes)
  const to = Math.max(...branchIndexes) + 1
  const roots = siblings.slice(from, to)
  const coveredIds = subtreeIds(roots)
  const selectedCoverage = new Set(subtreeIds(selectedEntries.map(({ node }) => node)))
  const additionalIds = coveredIds.filter((id) => !selectedCoverage.has(id))
  const lockedIds = coveredIds.filter((id) => index.entries.get(id)?.node.locked === true)
  if (lockedIds.length > 0) return { kind: "invalid", reason: "locked", ids: lockedIds }
  const boundaries = [
    ...new Set(
      coveredIds.flatMap((id) => {
        const boundary = index.entries.get(id)?.boundary
        return boundary === null || boundary === undefined ? [] : [boundary]
      }),
    ),
  ]
  if (boundaries.length > 1) return { kind: "invalid", reason: "mixed-boundary", boundaries }
  return {
    kind: additionalIds.length === 0 ? "exact" : "expanded",
    selectedIds,
    coveredIds,
    additionalIds,
    parentPath,
    range: { from, to },
    rootIds: roots.map((node) => node.id),
  }
}

export const expandTreeWrapSelection = (plan: TreeWrapPlan): readonly string[] =>
  plan.kind === "invalid" ? [] : plan.coveredIds

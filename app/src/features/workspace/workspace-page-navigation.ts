import {
  movePage,
  type Page,
  pageSchema,
  type Workspace,
  WorkspaceHierarchyError,
} from "@slop-lab/blocks-workspace"

export type PagePlacement =
  | { readonly kind: "root" }
  | { readonly kind: "before" | "inside" | "after"; readonly targetId: string }

export type VisiblePage = { readonly page: Page; readonly depth: number }

const descendantsOf = (workspace: Workspace, id: string): Set<string> => {
  const descendants = new Set<string>()
  const visit = (parentId: string) => {
    for (const page of workspace.pages) {
      if (page.parentId !== parentId || descendants.has(page.id)) continue
      descendants.add(page.id)
      visit(page.id)
    }
  }
  visit(id)
  return descendants
}

export const visiblePagePreorder = (workspace: Workspace): readonly VisiblePage[] => {
  const result: VisiblePage[] = []
  const visit = (parentId: string | null, depth: number) => {
    for (const page of workspace.pages) {
      if (page.parentId !== parentId || page.archived) continue
      result.push({ page, depth })
      visit(page.id, depth + 1)
    }
  }
  visit(null, 0)
  return result
}

export const pageMoveTargets = (workspace: Workspace, id: string): readonly Page[] => {
  const excluded = descendantsOf(workspace, id)
  excluded.add(id)
  return visiblePagePreorder(workspace)
    .map(({ page }) => page)
    .filter((page) => !excluded.has(page.id))
}

const subtreeEnd = (workspace: Workspace, id: string): number => {
  const subtree = descendantsOf(workspace, id)
  subtree.add(id)
  let end = -1
  for (const [index, page] of workspace.pages.entries()) if (subtree.has(page.id)) end = index
  return end + 1
}

export const moveWorkspacePage = (
  workspace: Workspace,
  id: string,
  placement: PagePlacement,
): Workspace => {
  const source = workspace.pages.find((page) => page.id === id)
  if (source === undefined) throw new WorkspaceHierarchyError(`Unknown page ${id}`)
  if (source.archived) throw new WorkspaceHierarchyError("Archived page")
  if (placement.kind !== "root" && placement.targetId === id)
    throw new WorkspaceHierarchyError("Page cycle")
  const target =
    placement.kind === "root"
      ? undefined
      : workspace.pages.find((page) => page.id === placement.targetId)
  if (placement.kind !== "root" && (target === undefined || target.archived))
    throw new WorkspaceHierarchyError("Invalid page target")

  const parentId =
    placement.kind === "root"
      ? null
      : placement.kind === "inside"
        ? placement.targetId
        : (target?.parentId ?? null)
  const moved = movePage(workspace, id, parentId)
  const subtree = descendantsOf(workspace, id)
  subtree.add(id)
  const moving = moved.pages.filter((page) => subtree.has(page.id))
  const remaining = moved.pages.filter((page) => !subtree.has(page.id))
  const base = { ...moved, pages: remaining }
  const insertion =
    placement.kind === "root"
      ? remaining.length
      : placement.kind === "before"
        ? remaining.findIndex((page) => page.id === placement.targetId)
        : subtreeEnd(base, placement.targetId)
  return {
    ...moved,
    pages: [...remaining.slice(0, insertion), ...moving, ...remaining.slice(insertion)],
  }
}

export const updateWorkspacePageTitle = (
  workspace: Workspace,
  id: string,
  title: string,
): Workspace => {
  const page = workspace.pages.find((candidate) => candidate.id === id)
  if (page === undefined) throw new WorkspaceHierarchyError(`Unknown page ${id}`)
  const updated = pageSchema.parse({ ...page, title })
  return {
    ...workspace,
    pages: workspace.pages.map((candidate) => (candidate.id === id ? updated : candidate)),
  }
}

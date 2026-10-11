import type { Page, Workspace } from "./schemas.js"

export class WorkspaceHierarchyError extends Error {
  readonly name = "WorkspaceHierarchyError"
}

const pageById = (workspace: Workspace, id: string): Page => {
  const page = workspace.pages.find((candidate) => candidate.id === id)
  if (page === undefined) throw new WorkspaceHierarchyError(`Unknown page ${id}`)
  return page
}

export const createPage = (workspace: Workspace, input: Omit<Page, "archived">): Workspace => {
  if (workspace.pages.some((page) => page.id === input.id))
    throw new WorkspaceHierarchyError(`Duplicate page ${input.id}`)
  if (input.parentId !== null) pageById(workspace, input.parentId)
  return { ...workspace, pages: [...workspace.pages, { ...input, archived: false }] }
}

export const movePage = (workspace: Workspace, id: string, parentId: string | null): Workspace => {
  pageById(workspace, id)
  if (id === parentId) throw new WorkspaceHierarchyError("Page cycle")
  let cursor = parentId
  while (cursor !== null) {
    if (cursor === id) throw new WorkspaceHierarchyError("Page cycle")
    cursor = pageById(workspace, cursor).parentId
  }
  return {
    ...workspace,
    pages: workspace.pages.map((page) => (page.id === id ? { ...page, parentId } : page)),
  }
}

const setArchived = (workspace: Workspace, id: string, archived: boolean): Workspace => {
  pageById(workspace, id)
  return {
    ...workspace,
    pages: workspace.pages.map((page) => (page.id === id ? { ...page, archived } : page)),
  }
}

export const archivePage = (workspace: Workspace, id: string): Workspace =>
  setArchived(workspace, id, true)
export const restorePage = (workspace: Workspace, id: string): Workspace => {
  const page = pageById(workspace, id)
  if (page.parentId !== null && pageById(workspace, page.parentId).archived)
    throw new WorkspaceHierarchyError("Restore the parent page first")
  return setArchived(workspace, id, false)
}

export const pageDepth = (workspace: Workspace, id: string): number => {
  let depth = 0
  let cursor = pageById(workspace, id).parentId
  while (cursor !== null) {
    depth += 1
    cursor = pageById(workspace, cursor).parentId
  }
  return depth
}

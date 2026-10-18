import { workspaceSchema } from "@slop-lab/blocks-workspace"
import { describe, expect, it } from "vitest"
import {
  moveWorkspacePage,
  updateWorkspacePageTitle,
  visiblePagePreorder,
} from "../src/features/workspace/workspace-page-navigation"

const workspace = workspaceSchema.parse({
  id: "navigation",
  version: 1,
  pages: [
    { id: "a", parentId: null, title: "A", icon: "file", archived: false },
    { id: "a-1", parentId: "a", title: "A1", icon: "file", archived: false },
    { id: "b", parentId: null, title: "B", icon: "file", archived: false },
    { id: "b-1", parentId: "b", title: "B1", icon: "file", archived: false },
    { id: "hidden", parentId: "b", title: "Hidden", icon: "file", archived: true },
    { id: "hidden-child", parentId: "hidden", title: "Leak", icon: "file", archived: false },
  ],
})

describe("workspace page navigation", () => {
  it("Given a flat workspace, When projected, Then pages use deterministic visible preorder", () => {
    expect(visiblePagePreorder(workspace).map(({ page, depth }) => [page.id, depth])).toEqual([
      ["a", 0],
      ["a-1", 1],
      ["b", 0],
      ["b-1", 1],
    ])
  })

  it("Given root and child pages, When moved before, inside, after, or root, Then order and parents agree", () => {
    const before = moveWorkspacePage(workspace, "b", { kind: "before", targetId: "a" })
    const inside = moveWorkspacePage(workspace, "a", { kind: "inside", targetId: "b" })
    const after = moveWorkspacePage(workspace, "a-1", { kind: "after", targetId: "b-1" })
    const root = moveWorkspacePage(inside, "a", { kind: "root" })

    expect(visiblePagePreorder(before).map(({ page }) => page.id)).toEqual(["b", "b-1", "a", "a-1"])
    expect(inside.pages.find((page) => page.id === "a")?.parentId).toBe("b")
    expect(visiblePagePreorder(inside).map(({ page }) => page.id)).toEqual(["b", "b-1", "a", "a-1"])
    expect(after.pages.find((page) => page.id === "a-1")?.parentId).toBe("b")
    expect(visiblePagePreorder(after).map(({ page }) => page.id)).toEqual(["a", "b", "b-1", "a-1"])
    expect(root.pages.find((page) => page.id === "a")?.parentId).toBeNull()
    expect(visiblePagePreorder(root).map(({ page }) => page.id)).toEqual(["b", "b-1", "a", "a-1"])
  })

  it("Given a parent page, When moved inside its descendant, Then the cycle is rejected without mutation", () => {
    expect(() => moveWorkspacePage(workspace, "a", { kind: "inside", targetId: "a-1" })).toThrow(
      /cycle/u,
    )
    expect(() => moveWorkspacePage(workspace, "a", { kind: "before", targetId: "a" })).toThrow(
      /cycle/u,
    )
    expect(() => moveWorkspacePage(workspace, "a", { kind: "after", targetId: "a" })).toThrow(
      /cycle/u,
    )
    expect(visiblePagePreorder(workspace).map(({ page }) => page.id)).toEqual([
      "a",
      "a-1",
      "b",
      "b-1",
    ])
  })

  it("Given page-title schema rules, When renaming, Then valid Korean is trimmed and empty text is rejected", () => {
    expect(updateWorkspacePageTitle(workspace, "a", "  새 제목  ").pages[0]?.title).toBe("새 제목")
    expect(() => updateWorkspacePageTitle(workspace, "a", "   ")).toThrow()
  })
})

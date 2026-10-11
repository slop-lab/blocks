import {
  addDatabaseProperty,
  addDatabaseRow,
  archivePage,
  copySyncedOccurrence,
  createPage,
  filterAndSortRows,
  headingLevelAtDepth,
  movePage,
  patchDatabaseRow,
  removeDatabaseProperty,
  restorePage,
  snapshotSyncedSource,
  workspaceSchema,
} from "@block-editor/workspace"
import { describe, expect, it } from "vitest"

const workspace = workspaceSchema.parse({
  id: "team-space",
  version: 1,
  pages: [
    { id: "root", parentId: null, title: "Product", icon: "file", archived: false },
    { id: "child", parentId: "root", title: "Research", icon: "file", archived: false },
  ],
})

describe("workspace hierarchy", () => {
  it("rejects a move that would create a page cycle", () => {
    expect(() => movePage(workspace, "root", "child")).toThrow(/cycle/u)
  })

  it("archives and restores a nested page without changing its parent", () => {
    const archived = archivePage(workspace, "child")
    const restored = restorePage(archived, "child")

    expect(restored.pages.find((page) => page.id === "child")).toMatchObject({
      parentId: "root",
      archived: false,
    })
  })

  it("creates a stable nested page", () => {
    const created = createPage(workspace, {
      id: "brief",
      parentId: "child",
      title: "Brief",
      icon: "file",
    })

    expect(created.pages.at(-1)).toMatchObject({ id: "brief", parentId: "child" })
  })
})

describe("context heading projection", () => {
  it("clamps authored relative levels without mutating the stored value", () => {
    const heading = { type: "heading" as const, level: 2, text: "Decisions" }

    expect([0, 1, 4, 8].map((depth) => headingLevelAtDepth(heading.level, depth))).toEqual([
      2, 3, 6, 6,
    ])
    expect(heading.level).toBe(2)
  })
})

describe("typed database projection", () => {
  const database = {
    id: "tasks",
    version: 1,
    name: "Tasks",
    properties: [
      { id: "name", name: "Name", type: "text" as const },
      { id: "status", name: "Status", type: "status" as const, options: ["Todo", "Done"] },
      { id: "score", name: "Score", type: "number" as const },
    ],
    rows: [
      { id: "r1", values: { name: "Ship", status: "Done", score: 2 } },
      { id: "r2", values: { name: "Draft", status: "Todo", score: 1 } },
    ],
  }

  it("patches a row only when the value matches the property type", () => {
    expect(patchDatabaseRow(database, "r2", "score", 3).rows[1]?.values["score"]).toBe(3)
    expect(() => patchDatabaseRow(database, "r2", "score", "high")).toThrow(/property/u)
  })

  it("filters, searches, and sorts rows deterministically", () => {
    const rows = filterAndSortRows(database, {
      query: "s",
      filter: { propertyId: "status", equals: "Done" },
      sort: { propertyId: "score", direction: "desc" },
    })

    expect(rows.map((row) => row.id)).toEqual(["r1"])
  })

  it("adds and removes typed properties without changing row identities", () => {
    const withOwner = addDatabaseProperty(database, {
      id: "owner",
      name: "Owner",
      type: "text",
    })
    const withRow = addDatabaseRow(withOwner, { id: "r3", values: { name: "Review" } })
    const removed = removeDatabaseProperty(withRow, "owner")

    expect(withRow.rows.map((row) => row.id)).toEqual(["r1", "r2", "r3"])
    expect(removed.properties.some((property) => property.id === "owner")).toBe(false)
    expect(Object.hasOwn(removed.rows[0]?.values ?? {}, "owner")).toBe(false)
  })
})

describe("synced source references", () => {
  it("duplicates references with a fresh occurrence and unlinks to fresh local blocks", () => {
    const occurrence = { id: "o1", sourceId: "shared-intro" }
    const duplicate = copySyncedOccurrence(occurrence, () => "o2")
    const snapshot = snapshotSyncedSource(
      {
        id: "shared-intro",
        version: 3,
        blocks: [{ id: "shared-block", type: "paragraph", text: "One source" }],
      },
      () => "local-block",
    )

    expect(duplicate).toEqual({ id: "o2", sourceId: "shared-intro" })
    expect(snapshot).toEqual([{ id: "local-block", type: "paragraph", text: "One source" }])
  })
})

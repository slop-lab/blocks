import {
  addDatabaseProperty,
  addDatabaseRow,
  archivePage,
  convertSectionToSyncedSource,
  copySyncedOccurrence,
  createPage,
  filterAndSortRows,
  groupDatabaseRows,
  headingLevelAtDepth,
  movePage,
  pageDocumentSchema,
  patchDatabaseRow,
  removeDatabaseProperty,
  restorePage,
  snapshotSyncedSource,
  syncedSourceSchema,
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

  it("groups rows by configured status and moves a row through the typed patch", () => {
    const groups = groupDatabaseRows(database, "status")
    const moved = patchDatabaseRow(database, "r2", "status", "Done")

    expect(groups.map((group) => [group.status, group.rows.map((row) => row.id)])).toEqual([
      ["Todo", ["r2"]],
      ["Done", ["r1"]],
    ])
    expect(groupDatabaseRows(moved, "status")[1]?.rows.map((row) => row.id)).toEqual(["r1", "r2"])
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
        section: {
          id: "shared-root",
          type: "section",
          children: [{ id: "shared-block", type: "paragraph", text: "One source" }],
        },
      },
      () => "local-block",
    )

    expect(duplicate).toEqual({ id: "o2", sourceId: "shared-intro" })
    expect(snapshot).toEqual([{ id: "local-block", type: "paragraph", text: "One source" }])
  })

  it("moves one local section into one canonical source and leaves one occurrence", () => {
    const ids = ["source", "source-root", "occurrence"]
    const converted = convertSectionToSyncedSource(
      {
        id: "local",
        type: "section",
        heading: "Shared notes",
        children: [{ id: "body", type: "paragraph", text: "Canonical content" }],
      },
      () => ids.shift() ?? "unexpected",
    )

    expect(converted.source).toEqual({
      id: "source",
      version: 1,
      section: {
        id: "source-root",
        type: "section",
        heading: "Shared notes",
        children: [{ id: "body", type: "paragraph", text: "Canonical content" }],
      },
    })
    expect(converted.occurrence).toEqual({
      id: "local",
      type: "section",
      occurrenceId: "occurrence",
      ref: { sourceId: "source" },
      children: [],
    })
  })

  it("preserves every supported nested child while moving a section into a source", () => {
    const children = [
      { id: "paragraph", type: "paragraph" as const, text: "Text" },
      { id: "code", type: "code" as const, text: "const value = 1" },
      { id: "page", type: "page_ref" as const, pageId: "target" },
      {
        id: "database",
        type: "database_embed" as const,
        databaseId: "tasks",
        layout: "table" as const,
      },
      {
        id: "callout",
        type: "callout" as const,
        children: [
          {
            id: "quote",
            type: "quote" as const,
            children: [{ id: "nested", type: "paragraph" as const, text: "Nested" }],
          },
        ],
      },
    ]

    const converted = convertSectionToSyncedSource(
      { id: "local", type: "section", heading: "All blocks", children },
      (() => {
        const ids = ["source", "source-root", "occurrence"]
        return () => ids.shift() ?? "unexpected"
      })(),
    )

    const source = syncedSourceSchema.parse(converted.source)
    if (source.section.type !== "section") throw new TypeError("Source root is not a section")
    expect(source.section.children).toEqual(children)
    expect(converted.occurrence.children).toEqual([])
  })

  it("rejects a canonical source that directly references itself", () => {
    const result = syncedSourceSchema.safeParse({
      id: "source",
      version: 1,
      section: {
        id: "root",
        type: "section",
        children: [
          {
            id: "recursive",
            type: "section",
            occurrenceId: "occurrence",
            ref: { sourceId: "source" },
            children: [],
          },
        ],
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toMatch(/cycle/u)
  })
})

describe("legacy workspace migration", () => {
  it("Given legacy headings and synced references, When parsed, Then nested sections preserve IDs and source identity", () => {
    const migrated = pageDocumentSchema.parse({
      pageId: "legacy",
      version: 1,
      blocks: [
        { id: "heading-a", type: "heading", level: 2, text: "A" },
        { id: "body-a", type: "paragraph", text: "Body A" },
        { id: "heading-b", type: "heading", level: 3, text: "B" },
        { id: "body-b", type: "quote", text: "Body B" },
        { id: "shared", type: "synced_ref", occurrenceId: "occurrence", sourceId: "source" },
      ],
    })

    expect(migrated.blocks).toEqual([
      {
        id: "heading-a",
        type: "section",
        heading: "A",
        children: [
          { id: "body-a", type: "paragraph", text: "Body A" },
          {
            id: "heading-b",
            type: "section",
            heading: "B",
            children: [
              {
                id: "body-b",
                type: "quote",
                children: [{ id: "body-b-content", type: "paragraph", text: "Body B" }],
              },
              {
                id: "shared",
                type: "section",
                occurrenceId: "occurrence",
                ref: { sourceId: "source" },
                children: [],
              },
            ],
          },
        ],
      },
    ])
  })

  it("Given a legacy source, When parsed, Then its content becomes one canonical source section", () => {
    expect(
      syncedSourceSchema.parse({
        id: "source",
        version: 4,
        blocks: [{ id: "p", type: "paragraph", text: "Shared" }],
      }),
    ).toEqual({
      id: "source",
      version: 4,
      section: {
        id: "source-root",
        type: "section",
        children: [{ id: "p", type: "paragraph", text: "Shared" }],
      },
    })
  })
})

import { pageDocumentSchema } from "@block-editor/workspace"
import { expect, it } from "vitest"
import {
  createWorkspaceProfile,
  embeddedDatabaseIds,
  pageDocumentToSnapshot,
  pageReferenceTargets,
  snapshotToPageDocument,
} from "../src/features/workspace/workspace-editor-model"
import { ModelSession } from "../src/pm/session"

it("round-trips workspace blocks through a contextual ProseMirror ModelSession", () => {
  const document = {
    pageId: "nested",
    version: 1,
    blocks: [
      {
        id: "h",
        type: "section" as const,
        heading: "Context",
        children: [{ id: "p", type: "paragraph" as const, text: "Body" }],
      },
      { id: "r", type: "page_ref" as const, pageId: "home" },
      {
        id: "s",
        type: "section" as const,
        occurrenceId: "o1",
        ref: { sourceId: "shared" },
        children: [],
      },
      { id: "d", type: "database_embed" as const, databaseId: "tasks", layout: "table" as const },
    ],
  }
  const profile = createWorkspaceProfile(2)
  const session = new ModelSession({
    modelId: document.pageId,
    document: pageDocumentToSnapshot(document),
    epoch: 1,
    version: document.version,
    readOnly: false,
    profile,
  })

  expect(session.state.doc.child(0).type.name).toBe("section")
  expect(profile.registrationsByNode.get("section")?.referenceAttrs).toEqual(["sourceId"])
  expect(session.state.doc.child(0).child(0).type.name).toBe("section_title")
  expect(snapshotToPageDocument(session.snapshot, document)).toEqual({ ...document, version: 2 })
})

it("finds database embeds inside recursive containers", () => {
  expect(
    embeddedDatabaseIds([
      {
        id: "section",
        type: "section",
        children: [
          {
            id: "callout",
            type: "callout",
            children: [
              { id: "database", type: "database_embed", databaseId: "tasks", layout: "table" },
            ],
          },
        ],
      },
    ]),
  ).toEqual(["tasks"])
})

it("finds persisted page references inside recursive containers", () => {
  expect(
    pageReferenceTargets([
      {
        id: "section",
        type: "section",
        children: [{ id: "reference", type: "page_ref", pageId: "target" }],
      },
    ]),
  ).toEqual([{ blockId: "reference", pageId: "target" }])
})

it("preserves rich inline marks and optional section titles across persisted snapshots", () => {
  const original = pageDocumentSchema.parse({
    pageId: "rich-page",
    version: 1,
    blocks: [
      {
        id: "rich",
        type: "paragraph",
        text: "Read docs",
        content: [
          { kind: "text", text: "Read ", marks: [{ type: "strong" }] },
          {
            kind: "text",
            text: "docs",
            marks: [{ type: "link", attrs: { href: "https://example.com/docs" } }],
          },
        ],
      },
      { id: "untitled", type: "section", children: [] },
    ],
  })
  const edited = snapshotToPageDocument(pageDocumentToSnapshot(original), original)

  expect(edited.blocks[0]).toEqual(original.blocks[0])
  expect(edited.blocks[1]).toEqual({ id: "untitled", type: "section", children: [] })
  expect(pageDocumentToSnapshot(edited).blocks[0]?.content).toEqual([
    { kind: "text", text: "Read ", marks: [{ type: "strong" }] },
    {
      kind: "text",
      text: "docs",
      marks: [{ type: "link", attrs: { href: "https://example.com/docs" } }],
    },
  ])
})

it("keeps every block visible while repairing duplicate durable IDs at the editor boundary", () => {
  const snapshot = pageDocumentToSnapshot({
    pageId: "duplicate-draft",
    version: 1,
    blocks: [
      {
        id: "section",
        type: "section",
        children: [
          { id: "duplicate", type: "paragraph", text: "Original" },
          {
            id: "duplicate",
            type: "quote",
            children: [{ id: "nested", type: "paragraph", text: "Replacement" }],
          },
        ],
      },
    ],
  })
  const childIds = snapshot.blocks[0]?.children?.map((block) => block.id)

  expect(childIds).toEqual(["duplicate", "duplicate__duplicate_1"])
  expect(snapshot.blocks[0]?.children?.map((block) => block.type)).toEqual(["paragraph", "quote"])
  expect(
    () =>
      new ModelSession({
        modelId: "duplicate-draft",
        document: snapshot,
        epoch: 1,
        version: 1,
        readOnly: false,
        profile: createWorkspaceProfile(0),
      }),
  ).not.toThrow()
})

it("reserves repair-like original IDs before allocating recursive duplicate replacements", () => {
  const document = {
    pageId: "collision-draft",
    version: 1,
    blocks: [
      { id: "x", type: "paragraph" as const, text: "First" },
      {
        id: "x",
        type: "quote" as const,
        children: [
          { id: "x__duplicate_1", type: "paragraph" as const, text: "Reserved" },
          {
            id: "deep",
            type: "callout" as const,
            children: [
              { id: "x", type: "paragraph" as const, text: "Deep duplicate" },
              {
                id: "source-occurrence",
                type: "section" as const,
                occurrenceId: "occurrence-x",
                ref: { sourceId: "x" },
                children: [],
              },
            ],
          },
        ],
      },
    ],
  }

  const first = pageDocumentToSnapshot(document)
  const second = pageDocumentToSnapshot(document)
  const ids: string[] = []
  first.blocks.forEach((block) => {
    const visit = (current: typeof block): void => {
      ids.push(current.id)
      current.children?.forEach(visit)
    }
    visit(block)
  })

  expect(ids).toEqual([
    "x",
    "x__duplicate_2",
    "x__duplicate_1",
    "deep",
    "x__duplicate_3",
    "source-occurrence",
  ])
  expect(new Set(ids).size).toBe(ids.length)
  expect(first).toEqual(second)
  expect(first.blocks[1]?.children?.[1]?.children?.[1]?.attrs).toEqual({
    sourceId: "x",
    occurrenceId: "occurrence-x",
  })
})

it("round-trips opaque workspace payloads while editing a known neighbor", () => {
  const opaque = {
    id: "diagram",
    type: "vendor.diagram",
    attrs: { canvas: { width: 640 } },
    content: [{ kind: "vendor.label", text: "Raw label", metadata: { locale: "ko" } }],
    children: [{ id: "shape", type: "vendor.shape", attrs: { x: 12, y: 20 } }],
  }
  const original = pageDocumentSchema.parse({
    pageId: "opaque-page",
    version: 1,
    blocks: [
      opaque,
      { id: "known", type: "paragraph", text: "Before" },
      {
        id: "known-extension",
        type: "paragraph",
        text: "Unsupported mark",
        content: [
          {
            kind: "text",
            text: "Unsupported mark",
            marks: [{ type: "color", attrs: { value: "orange" } }],
          },
        ],
      },
    ],
  })
  const snapshot = pageDocumentToSnapshot(original)
  const session = new ModelSession({
    modelId: original.pageId,
    document: snapshot,
    epoch: 1,
    version: original.version,
    readOnly: false,
    profile: createWorkspaceProfile(0),
  })
  const editedSnapshot = {
    ...session.snapshot,
    blocks: session.snapshot.blocks.map((block) =>
      block.id === "known"
        ? { ...block, content: [{ kind: "text" as const, text: "After", marks: [] }] }
        : block,
    ),
  }

  const edited = snapshotToPageDocument(editedSnapshot, original)

  expect(edited.blocks[0]).toEqual(opaque)
  expect(edited.blocks[1]).toEqual({ id: "known", type: "paragraph", text: "After" })
  expect(edited.blocks[2]).toEqual(original.blocks[2])
  expect(session.state.doc.child(0).type.name).toBe("opaque")
  expect(session.state.doc.child(2).type.name).toBe("opaque")
  expect(snapshot.blocks[0]).toMatchObject({
    id: "diagram",
    type: "workspace.opaque",
    originalType: "vendor.diagram",
    locked: true,
  })
})

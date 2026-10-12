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

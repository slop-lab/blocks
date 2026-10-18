import { snapshotToPm } from "@slop-lab/blocks-prosemirror"
import type { PageDocument, SyncedSource } from "@slop-lab/blocks-workspace"
import { expect, it } from "vitest"
import {
  createWorkspaceProfile,
  pageDocumentToSnapshot,
} from "../src/features/workspace/workspace-editor-model"
import {
  focusedLocalBlocks,
  focusHash,
  parseFocusHash,
  resolveWorkspaceFocus,
} from "../src/features/workspace/workspace-focus-navigation"
import { workspaceFocusDecorations } from "../src/features/workspace/workspace-focus-view"

const document: PageDocument = {
  pageId: "research",
  version: 1,
  blocks: [
    { id: "before", type: "paragraph", text: "Before" },
    {
      id: "outer",
      type: "section",
      heading: "Research notes",
      children: [
        {
          id: "middle",
          type: "callout",
          children: [{ id: "leaf", type: "paragraph", text: "Nested finding" }],
        },
      ],
    },
    {
      id: "shared-occurrence",
      type: "section",
      occurrenceId: "occurrence-a",
      ref: { sourceId: "source-a" },
      children: [],
    },
  ],
}

const source: SyncedSource = {
  id: "source-a",
  version: 3,
  section: {
    id: "source-root",
    type: "section",
    heading: "Shared methods",
    children: [{ id: "shared-leaf", type: "paragraph", text: "Canonical shared text" }],
  },
}

it("resolves a nested local block with root and ancestor breadcrumbs", () => {
  const focus = resolveWorkspaceFocus({
    pageTitle: "User research",
    document,
    sources: [source],
    target: { kind: "local", blockId: "leaf" },
  })

  expect(focus?.target).toEqual({ kind: "local", blockId: "leaf" })
  expect(focus?.breadcrumbs.map((crumb) => crumb.label)).toEqual([
    "User research",
    "Research notes",
    "Callout",
    "Nested finding",
  ])
  expect(focus?.breadcrumbs.map((crumb) => crumb.target)).toEqual([
    null,
    { kind: "local", blockId: "outer" },
    { kind: "local", blockId: "middle" },
    { kind: "local", blockId: "leaf" },
  ])
})

it("keeps a shared block target scoped to its exact occurrence and canonical source", () => {
  const focus = resolveWorkspaceFocus({
    pageTitle: "User research",
    document,
    sources: [source],
    target: { kind: "shared", occurrenceId: "occurrence-a", blockId: "shared-leaf" },
  })

  expect(focus?.target).toEqual({
    kind: "shared",
    occurrenceId: "occurrence-a",
    blockId: "shared-leaf",
  })
  expect(focus?.sourceId).toBe("source-a")
  expect(focus?.breadcrumbs.map((crumb) => crumb.label)).toEqual([
    "User research",
    "Shared methods",
    "Canonical shared text",
  ])
})

it("round-trips namespaced focus hashes without consuming backlink reveal hashes", () => {
  const target = { kind: "shared", occurrenceId: "occurrence:a", blockId: "block/one" } as const

  expect(parseFocusHash(focusHash(target))).toEqual(target)
  expect(parseFocusHash("#nested-leaf")).toBeNull()
  expect(parseFocusHash("#focus=missing-parts")).toBeNull()
})

it("falls back to the closest known local ancestor when a focused block is deleted", () => {
  const focus = resolveWorkspaceFocus({
    pageTitle: "User research",
    document: {
      pageId: "research",
      version: 2,
      blocks: [
        { id: "before", type: "paragraph", text: "Before" },
        { id: "outer", type: "section", heading: "Research notes", children: [] },
      ],
    },
    sources: [source],
    target: { kind: "local", blockId: "leaf" },
    previousAncestors: ["outer", "middle"],
  })

  expect(focus?.target).toEqual({ kind: "local", blockId: "outer" })
})

it("keeps a deleted shared target inside its original occurrence when an ancestor survives", () => {
  const focus = resolveWorkspaceFocus({
    pageTitle: "User research",
    document,
    sources: [
      {
        ...source,
        version: 4,
        section: { ...source.section, children: [] },
      },
    ],
    target: { kind: "shared", occurrenceId: "occurrence-a", blockId: "shared-leaf" },
    previousAncestors: ["source-root", "shared-leaf"],
  })

  expect(focus?.target).toEqual({
    kind: "shared",
    occurrenceId: "occurrence-a",
    blockId: "source-root",
  })
})

it("decorates only branches unrelated to a nested focus while retaining the canonical document", () => {
  const profile = createWorkspaceProfile(0)
  const canonical = snapshotToPm(pageDocumentToSnapshot(document), profile)

  const decorations = workspaceFocusDecorations(canonical, { kind: "local", blockId: "leaf" })

  expect(canonical.childCount).toBe(3)
  expect(decorations?.find()).toHaveLength(2)
  expect(
    workspaceFocusDecorations(canonical, {
      kind: "shared",
      occurrenceId: "occurrence-a",
      blockId: "focus-leaf",
    })?.find(),
  ).toHaveLength(2)
})

it("limits adjacent database panels to embeds inside the focused local subtree", () => {
  const databaseDocument: PageDocument = {
    pageId: "databases",
    version: 1,
    blocks: [
      { id: "outside-db", type: "database_embed", databaseId: "outside", layout: "table" },
      {
        id: "focused-section",
        type: "section",
        children: [
          { id: "inside-db", type: "database_embed", databaseId: "inside", layout: "table" },
        ],
      },
    ],
  }
  const focus = resolveWorkspaceFocus({
    pageTitle: "Databases",
    document: databaseDocument,
    sources: [],
    target: { kind: "local", blockId: "focused-section" },
  })

  expect(focusedLocalBlocks(databaseDocument, focus).map((block) => block.id)).toEqual([
    "focused-section",
  ])
  expect(focusedLocalBlocks(databaseDocument, null)).toEqual(databaseDocument.blocks)
})

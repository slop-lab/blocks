import { describe, expect, it } from "vitest"
import { createWorkspaceProfile } from "../src/features/workspace/workspace-editor-model"
import {
  cloneBlockNode,
  resolveInsertionBookmark,
  selectedBlockNodes,
  selectionContainsLockedNode,
} from "../src/pm/block-selection-document"

const workspaceSchema = createWorkspaceProfile(0).schema

const createDocument = (sectionLocked = false, nestedLocked = false) =>
  workspaceSchema.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "section",
        attrs: { id: "section", locked: sectionLocked },
        content: [
          {
            type: "paragraph",
            attrs: { id: "nested", locked: nestedLocked },
            content: [{ type: "text", text: "Nested" }],
          },
        ],
      },
      {
        type: "paragraph",
        attrs: { id: "sibling" },
        content: [{ type: "text", text: "Sibling" }],
      },
    ],
  })

describe("block selection document operations", () => {
  it("canonicalizes a selected ancestor and descendant into one operation root", () => {
    const selected = selectedBlockNodes(createDocument(), ["nested", "sibling", "section"])

    expect(selected.map(({ id }) => id)).toEqual(["section", "sibling"])
  })

  it("rejects mutation when a selected ancestor contains a locked descendant", () => {
    expect(selectionContainsLockedNode(createDocument(false, true), ["section"])).toBe(true)
  })

  it("rejects mutation when a selected node is inside a locked ancestor", () => {
    expect(selectionContainsLockedNode(createDocument(true), ["nested"])).toBe(true)
  })

  it("resolves an insertion bookmark only while the post-cut document remains unchanged", () => {
    const document = createDocument()
    const bookmark = { document, position: document.child(0).nodeSize }

    expect(resolveInsertionBookmark(document, bookmark)).toBe(bookmark.position)
    expect(resolveInsertionBookmark(createDocument(), bookmark)).toBeNull()
    expect(resolveInsertionBookmark(createDocument(true), bookmark)).toBeNull()
  })

  it("preserves ordinary string attributes that equal a cloned block identity", () => {
    const section = createWorkspaceProfile(0).schema.nodeFromJSON({
      type: "section",
      attrs: { id: "section", sourceId: "nested" },
      content: [{ type: "paragraph", attrs: { id: "nested" } }],
    })

    const cloned = cloneBlockNode(
      section,
      new Map([
        ["section", "cloned-section"],
        ["nested", "cloned-nested"],
      ]),
    )

    expect(cloned.attrs["id"]).toBe("cloned-section")
    expect(cloned.attrs["sourceId"]).toBe("nested")
  })

  it("remaps only explicitly declared identity-reference attributes", () => {
    const section = createWorkspaceProfile(0).schema.nodeFromJSON({
      type: "section",
      attrs: { id: "section", sourceId: "nested", occurrenceId: "nested" },
      content: [{ type: "paragraph", attrs: { id: "nested" } }],
    })

    const cloned = cloneBlockNode(
      section,
      new Map([
        ["section", "cloned-section"],
        ["nested", "cloned-nested"],
      ]),
      (node) => (node.type.name === "section" ? ["sourceId"] : []),
    )

    expect(cloned.attrs["sourceId"]).toBe("cloned-nested")
    expect(cloned.attrs["occurrenceId"]).toBe("nested")
  })
})

import type { Node as ProseMirrorNode } from "prosemirror-model"
import { EditorState, TextSelection } from "prosemirror-state"
import { describe, expect, it } from "vitest"
import { createWorkspaceProfile } from "../src/features/workspace/workspace-editor-model"
import {
  blockPositionById,
  parseSlashQuery,
  safeLinkHref,
} from "../src/pm/block-interaction-commands"
import { captureLinkTarget, isCurrentLinkTarget } from "../src/pm/link-selection"
import { editorSchema } from "../src/pm/schema"

const paragraph = (id: string, text: string) =>
  editorSchema.nodes.paragraph.create(
    { id, locked: false },
    text.length === 0 ? undefined : editorSchema.text(text),
  )
const documentWith = (...blocks: readonly ProseMirrorNode[]) =>
  editorSchema.nodes.doc.create(undefined, blocks)

describe("slash and link boundaries", () => {
  it("recognizes only a leading slash query in an eligible text block", () => {
    const document = documentWith(paragraph("slash", "/제"))
    const state = EditorState.create({
      schema: editorSchema,
      doc: document,
      selection: TextSelection.create(document, 3),
    })

    const query = parseSlashQuery(state)

    expect(query?.query).toBe("제")
    expect(parseSlashQuery(state, true)).toBeNull()
  })

  it("recognizes a slash query inside a semantic section", () => {
    const profile = createWorkspaceProfile(1)
    const documentType = profile.schema.nodes["doc"]
    const section = profile.schema.nodes["section"]
    const title = profile.schema.nodes["section_title"]
    const text = profile.schema.nodes["paragraph"]
    if (
      documentType === undefined ||
      section === undefined ||
      title === undefined ||
      text === undefined
    )
      throw new TypeError("Workspace container schema is incomplete")
    const document = documentType.create(undefined, [
      section.create({ id: "section", sourceId: "", occurrenceId: "", locked: false }, [
        title.create(undefined, profile.schema.text("Title")),
        text.create({ id: "slash", locked: false }, profile.schema.text("/quote")),
      ]),
    ])
    const paragraphPosition = blockPositionById(document, "slash")
    const state = EditorState.create({
      schema: profile.schema,
      doc: document,
      selection: TextSelection.create(document, paragraphPosition + 7),
    })

    expect(parseSlashQuery(state)?.query).toBe("quote")
  })

  it("rejects slash queries in code and captions", () => {
    const code = editorSchema.nodes.code_block.create(
      { id: "code", locked: false },
      editorSchema.text("/code"),
    )
    const document = editorSchema.nodes.doc.create(undefined, code)
    const state = EditorState.create({
      schema: editorSchema,
      doc: document,
      selection: TextSelection.create(document, 6),
    })

    expect(parseSlashQuery(state)).toBeNull()
  })

  it("accepts safe links and rejects executable protocols", () => {
    expect(safeLinkHref("https://example.com/path")).toBe("https://example.com/path")
    expect(safeLinkHref("/docs/start")).toBe("/docs/start")
    expect(safeLinkHref("mailto:reader@example.com")).toBe("mailto:reader@example.com")
    expect(safeLinkHref("//external.example/path")).toBeNull()
    expect(safeLinkHref("javascript:alert(1)")).toBeNull()
  })

  it("captures an existing link and rejects its bookmark after a document change", () => {
    const linkMark = editorSchema.marks.link
    if (linkMark === undefined) throw new TypeError("Link mark is missing")
    const document = documentWith(
      editorSchema.nodes.paragraph.create(
        { id: "linked", locked: false },
        editorSchema.text("linked", [linkMark.create({ href: "/existing" })]),
      ),
    )
    let state = EditorState.create({
      schema: editorSchema,
      doc: document,
      selection: TextSelection.create(document, 1, 7),
    })

    const target = captureLinkTarget(state, linkMark)

    expect(target?.href).toBe("/existing")
    if (target === null) throw new TypeError("Link target was not captured")
    expect(isCurrentLinkTarget(state, target)).toBe(true)
    state = state.apply(state.tr.insertText("!", 7))
    expect(isCurrentLinkTarget(state, target)).toBe(false)
  })
})

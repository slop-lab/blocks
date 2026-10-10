import { undo } from "prosemirror-history"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import { EditorState, TextSelection } from "prosemirror-state"
import { describe, expect, it } from "vitest"
import {
  blockPositionById,
  createBlockAfter,
  moveBlockById,
  parseSlashQuery,
  safeLinkHref,
} from "../src/pm/block-interaction-commands"
import { createEditorState } from "../src/pm/editor"
import { captureLinkTarget, isCurrentLinkTarget } from "../src/pm/link-selection"
import { editorSchema } from "../src/pm/schema"

const paragraph = (id: string, text: string, locked = false) =>
  editorSchema.nodes.paragraph.create(
    { id, locked },
    text.length === 0 ? undefined : editorSchema.text(text),
  )

const documentWith = (...blocks: readonly ProseMirrorNode[]) =>
  editorSchema.nodes.doc.create(undefined, blocks)

describe("block interaction commands", () => {
  it("moves a stable block ID in one undoable transaction", () => {
    // Given
    let state = createEditorState({
      document: documentWith(paragraph("a", "첫째"), paragraph("b", "둘째")),
      readonly: false,
    })
    const dispatch = (transaction: Parameters<typeof state.apply>[0]) => {
      state = state.apply(transaction)
    }

    // When
    expect(moveBlockById("a", 2)(state, dispatch)).toBe(true)

    // Then
    expect(state.doc.child(1).attrs["id"]).toBe("a")
    expect(undo(state, dispatch)).toBe(true)
    expect(state.doc.child(0).attrs["id"]).toBe("a")
  })

  it("refuses to move a locked source block", () => {
    // Given
    const state = EditorState.create({
      schema: editorSchema,
      doc: documentWith(paragraph("locked", "고정", true), paragraph("free", "이동")),
    })

    // When
    const handled = moveBlockById("locked", 2)(state)

    // Then
    expect(handled).toBe(false)
  })

  it("moves across a locked neighbor without changing the locked block", () => {
    // Given
    let state = createEditorState({
      document: documentWith(
        paragraph("a", "첫째"),
        paragraph("locked", "고정", true),
        paragraph("c", "셋째"),
      ),
      readonly: false,
    })
    const lockedBefore = state.doc.child(1).toJSON()

    // When
    const handled = moveBlockById("a", 3)(state, (transaction) => {
      state = state.apply(transaction)
    })

    // Then
    expect(handled).toBe(true)
    expect(state.doc.child(0).toJSON()).toEqual(lockedBefore)
    expect(state.doc.child(2).attrs["id"]).toBe("a")
  })

  it("resolves positions by current stable identity and inserts after it", () => {
    // Given
    let state = EditorState.create({
      schema: editorSchema,
      doc: documentWith(paragraph("a", "첫째"), paragraph("b", "둘째")),
    })
    const dispatch = (transaction: Parameters<typeof state.apply>[0]) => {
      state = state.apply(transaction)
    }

    // When
    expect(createBlockAfter("a")(state, dispatch)).toBe(true)

    // Then
    expect(blockPositionById(state.doc, "b")).toBeGreaterThan(blockPositionById(state.doc, "a"))
    expect(state.doc.childCount).toBe(3)
  })

  it("moves the captured source identity after another block is reordered", () => {
    // Given
    let state = createEditorState({
      document: documentWith(
        paragraph("a", "첫째"),
        paragraph("b", "둘째"),
        paragraph("c", "셋째"),
      ),
      readonly: false,
    })
    const dispatch = (transaction: Parameters<typeof state.apply>[0]) => {
      state = state.apply(transaction)
    }

    // When
    expect(moveBlockById("c", 0)(state, dispatch)).toBe(true)
    expect(moveBlockById("a", 3)(state, dispatch)).toBe(true)

    // Then
    expect(state.doc.child(2).attrs["id"]).toBe("a")
  })
})

describe("slash and link boundaries", () => {
  it("recognizes only a leading slash query in an eligible text block", () => {
    // Given
    const state = EditorState.create({
      schema: editorSchema,
      doc: documentWith(paragraph("slash", "/제")),
      selection: TextSelection.create(documentWith(paragraph("slash", "/제")), 3),
    })

    // When
    const query = parseSlashQuery(state)

    // Then
    expect(query?.query).toBe("제")
    expect(parseSlashQuery(state, true)).toBeNull()
  })

  it("rejects slash queries in code and captions", () => {
    // Given
    const code = editorSchema.nodes.code_block.create(
      { id: "code", locked: false },
      editorSchema.text("/code"),
    )
    const state = EditorState.create({
      schema: editorSchema,
      doc: editorSchema.nodes.doc.create(undefined, code),
      selection: TextSelection.create(editorSchema.nodes.doc.create(undefined, code), 6),
    })

    // When / Then
    expect(parseSlashQuery(state)).toBeNull()
  })

  it("accepts safe links and rejects executable protocols", () => {
    // Given / When / Then
    expect(safeLinkHref("https://example.com/path")).toBe("https://example.com/path")
    expect(safeLinkHref("/docs/start")).toBe("/docs/start")
    expect(safeLinkHref("mailto:reader@example.com")).toBe("mailto:reader@example.com")
    expect(safeLinkHref("//external.example/path")).toBeNull()
    expect(safeLinkHref("javascript:alert(1)")).toBeNull()
  })

  it("captures an existing link and rejects its bookmark after a document change", () => {
    // Given
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

    // When
    const target = captureLinkTarget(state, linkMark)

    // Then
    expect(target?.href).toBe("/existing")
    if (target === null) throw new TypeError("Link target was not captured")
    expect(isCurrentLinkTarget(state, target)).toBe(true)
    state = state.apply(state.tr.insertText("!", 7))
    expect(isCurrentLinkTarget(state, target)).toBe(false)
  })
})

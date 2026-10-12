import { undo } from "prosemirror-history"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import { EditorState } from "prosemirror-state"
import { describe, expect, it } from "vitest"
import { createWorkspaceProfile } from "../src/features/workspace/workspace-editor-model"
import {
  blockPositionById,
  createBlockAfter,
  duplicateBlockById,
  indentBlocksById,
  moveBlockById,
  moveBlocksById,
  outdentBlocksById,
} from "../src/pm/block-interaction-commands"
import { createEditorState } from "../src/pm/editor"
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

  it("moves selected sibling blocks as one undoable batch", () => {
    let state = createEditorState({
      document: documentWith(
        paragraph("a", "첫째"),
        paragraph("b", "둘째"),
        paragraph("c", "셋째"),
        paragraph("d", "넷째"),
      ),
      readonly: false,
    })
    const dispatch = (transaction: Parameters<typeof state.apply>[0]) => {
      state = state.apply(transaction)
    }

    expect(moveBlocksById(["a", "c"], 4)(state, dispatch)).toBe(true)

    expect(
      Array.from(
        { length: state.doc.childCount },
        (_, index) => state.doc.child(index).attrs["id"],
      ),
    ).toEqual(["b", "d", "a", "c"])
    expect(undo(state, dispatch)).toBe(true)
    expect(
      Array.from(
        { length: state.doc.childCount },
        (_, index) => state.doc.child(index).attrs["id"],
      ),
    ).toEqual(["a", "b", "c", "d"])
  })

  it("rejects a batch move when any selected block is locked", () => {
    const state = EditorState.create({
      schema: editorSchema,
      doc: documentWith(
        paragraph("a", "첫째"),
        paragraph("locked", "고정", true),
        paragraph("c", "셋째"),
      ),
    })

    expect(moveBlocksById(["a", "locked"], 3)(state)).toBe(false)
  })

  it("indents and outdents selected siblings as one structural batch", () => {
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
    const textBlock = (id: string, value: string) =>
      text.create({ id, locked: false }, profile.schema.text(value))
    let state = EditorState.create({
      schema: profile.schema,
      doc: documentType.create(undefined, [
        section.create({ id: "section", locked: false }, [
          title.create(undefined, profile.schema.text("Title")),
        ]),
        textBlock("a", "A"),
        textBlock("b", "B"),
      ]),
    })
    const dispatch = (transaction: Parameters<typeof state.apply>[0]) => {
      state = state.apply(transaction)
    }

    expect(indentBlocksById(["a", "b"])(state, dispatch)).toBe(true)
    expect(state.doc.childCount).toBe(1)
    expect(state.doc.child(0).childCount).toBe(3)
    expect(outdentBlocksById(["a", "b"])(state, dispatch)).toBe(true)
    expect(state.doc.childCount).toBe(3)
    expect(state.doc.child(1).attrs["id"]).toBe("a")
    expect(state.doc.child(2).attrs["id"]).toBe("b")
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

  it("duplicates text content with a fresh block identity", () => {
    let state = createEditorState({
      document: documentWith(paragraph("source", "복제할 본문")),
      readonly: false,
    })

    const handled = duplicateBlockById("source")(state, (transaction) => {
      state = state.apply(transaction)
    })

    expect(handled).toBe(true)
    expect(state.doc.childCount).toBe(2)
    expect(state.doc.child(1).textContent).toBe("복제할 본문")
    expect(state.doc.child(1).attrs["id"]).not.toBe("source")
  })
})

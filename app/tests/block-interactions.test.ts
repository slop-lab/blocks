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
  moveBlocksToById,
  outdentBlocksById,
  planBlockWrap,
  wrapBlocksById,
} from "../src/pm/block-interaction-commands"
import { insideRailCorridor } from "../src/pm/block-pointer-intent"
import { createEditorState } from "../src/pm/editor"
import { editorSchema } from "../src/pm/schema"

const paragraph = (id: string, text: string, locked = false) =>
  editorSchema.nodes.paragraph.create(
    { id, locked },
    text.length === 0 ? undefined : editorSchema.text(text),
  )

const documentWith = (...blocks: readonly ProseMirrorNode[]) =>
  editorSchema.nodes.doc.create(undefined, blocks)

describe("block rail pointer intent", () => {
  it("Given a tall parent block, When the pointer is over nested content, Then the parent corridor does not cover it", () => {
    const block: DOMRect = {
      x: 200,
      y: 100,
      left: 200,
      top: 100,
      right: 800,
      bottom: 600,
      width: 600,
      height: 500,
      toJSON: () => ({}),
    }
    const rail: DOMRect = {
      x: 152,
      y: 100,
      left: 152,
      top: 100,
      right: 192,
      bottom: 132,
      width: 40,
      height: 32,
      toJSON: () => ({}),
    }

    expect(insideRailCorridor({ x: 400, y: 260 }, { block, rail })).toBe(false)
    expect(insideRailCorridor({ x: 196, y: 116 }, { block, rail })).toBe(true)
  })
})

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

  it("moves a stable block identity between the root and a nested container in one undo step", () => {
    const profile = createWorkspaceProfile(0)
    const documentType = profile.schema.nodes["doc"]
    const sectionType = profile.schema.nodes["section"]
    const paragraphType = profile.schema.nodes["paragraph"]
    if (documentType === undefined || sectionType === undefined || paragraphType === undefined)
      throw new TypeError("Workspace nested move schema is incomplete")
    const block = (id: string) =>
      paragraphType.create({ id, locked: false }, profile.schema.text(id))
    let state = createEditorState({
      document: documentType.create(undefined, [
        block("root"),
        sectionType.create({ id: "section", locked: false }, [block("nested")]),
        block("after"),
      ]),
      readonly: false,
      profile,
    })
    const dispatch = (transaction: Parameters<typeof state.apply>[0]) => {
      state = state.apply(transaction)
    }

    expect(moveBlocksToById(["root"], { parentId: "section", index: 1 })(state, dispatch)).toBe(
      true,
    )
    expect(state.doc.child(0).child(1).attrs["id"]).toBe("root")
    expect(undo(state, dispatch)).toBe(true)
    expect(state.doc.child(0).attrs["id"]).toBe("root")

    expect(moveBlocksToById(["nested"], { parentId: null, index: 3 })(state, dispatch)).toBe(true)
    expect(state.doc.child(3).attrs["id"]).toBe("nested")
    expect(undo(state, dispatch)).toBe(true)
    expect(state.doc.child(1).child(0).attrs["id"]).toBe("nested")
  })

  it("rejects moving a container into its own subtree or a locked destination", () => {
    const profile = createWorkspaceProfile(0)
    const documentType = profile.schema.nodes["doc"]
    const sectionType = profile.schema.nodes["section"]
    const paragraphType = profile.schema.nodes["paragraph"]
    if (documentType === undefined || sectionType === undefined || paragraphType === undefined)
      throw new TypeError("Workspace nested move schema is incomplete")
    const child = paragraphType.create({ id: "child", locked: false })
    const state = EditorState.create({
      schema: profile.schema,
      doc: documentType.create(undefined, [
        sectionType.create({ id: "section", locked: false }, [child]),
        sectionType.create({ id: "locked", locked: true }, [
          paragraphType.create({ id: "locked-child", locked: false }),
        ]),
      ]),
    })

    expect(moveBlocksToById(["section"], { parentId: "child", index: 0 })(state)).toBe(false)
    expect(moveBlocksToById(["child"], { parentId: "locked", index: 1 })(state)).toBe(false)
    expect(moveBlocksToById(["locked-child"], { parentId: null, index: 2 })(state)).toBe(false)
  })

  it("allows a cross-level move when unrelated siblings are locked", () => {
    const profile = createWorkspaceProfile(0)
    const documentType = profile.schema.nodes["doc"]
    const sectionType = profile.schema.nodes["section"]
    const paragraphType = profile.schema.nodes["paragraph"]
    if (documentType === undefined || sectionType === undefined || paragraphType === undefined)
      throw new TypeError("Workspace nested move schema is incomplete")
    const block = (id: string, locked = false) => paragraphType.create({ id, locked })
    let state = createEditorState({
      document: documentType.create(undefined, [
        sectionType.create({ id: "source", locked: false }, [
          block("moving"),
          block("source-locked-sibling", true),
        ]),
        sectionType.create({ id: "target", locked: false }, [block("target-locked-sibling", true)]),
      ]),
      readonly: false,
      profile,
    })

    expect(
      moveBlocksToById(["moving"], { parentId: "target", index: 1 })(state, (transaction) => {
        state = state.apply(transaction)
      }),
    ).toBe(true)
    expect(state.doc.child(1).child(1).attrs["id"]).toBe("moving")
  })

  it("moves an unlocked root block despite an unrelated locked root sibling", () => {
    const profile = createWorkspaceProfile(0)
    const documentType = profile.schema.nodes["doc"]
    const sectionType = profile.schema.nodes["section"]
    const paragraphType = profile.schema.nodes["paragraph"]
    if (documentType === undefined || sectionType === undefined || paragraphType === undefined)
      throw new TypeError("Workspace nested move schema is incomplete")
    const moving = paragraphType.create({ id: "moving", locked: false })
    const lockedSibling = paragraphType.create({ id: "locked-root-sibling", locked: true })
    const targetChild = paragraphType.create({ id: "target-child", locked: false })
    let state = createEditorState({
      document: documentType.create(undefined, [
        moving,
        lockedSibling,
        sectionType.create({ id: "target", locked: false }, [targetChild]),
      ]),
      readonly: false,
      profile,
    })
    const lockedBefore = state.doc.child(1).toJSON()

    expect(
      moveBlocksToById(["moving"], { parentId: "target", index: 1 })(state, (transaction) => {
        state = state.apply(transaction)
      }),
    ).toBe(true)
    expect(state.doc.child(0).toJSON()).toEqual(lockedBefore)
    expect(state.doc.child(1).child(1).attrs["id"]).toBe("moving")
  })

  it.each([
    ["section", "section"],
    ["callout", "callout"],
    ["container_quote", "quote"],
  ])("wraps selected siblings in one undoable %s transaction", (nodeName, snapshotType) => {
    const profile = createWorkspaceProfile(0)
    const documentType = profile.schema.nodes["doc"]
    const paragraphType = profile.schema.nodes["paragraph"]
    const containerType = profile.schema.nodes[nodeName]
    if (documentType === undefined || paragraphType === undefined || containerType === undefined)
      throw new TypeError("Workspace wrapping schema is incomplete")
    const textBlock = (id: string, value: string) =>
      paragraphType.create({ id, locked: false }, profile.schema.text(value))
    let state = createEditorState({
      document: documentType.create(undefined, [
        textBlock("a", "A"),
        textBlock("b", "B"),
        textBlock("c", "C"),
      ]),
      readonly: false,
      profile,
    })
    const dispatch = (transaction: Parameters<typeof state.apply>[0]) => {
      state = state.apply(transaction)
    }

    expect(wrapBlocksById(["a", "b"], containerType)(state, dispatch)).toBe(true)

    expect(state.doc.child(0).type.name).toBe(nodeName)
    expect(state.doc.child(0).attrs["id"]).toEqual(expect.any(String))
    expect(state.doc.child(0).attrs["snapshotType"] || snapshotType).toBe(snapshotType)
    expect(state.doc.child(0).child(0).attrs["id"]).toBe("a")
    expect(state.doc.child(0).child(1).attrs["id"]).toBe("b")
    expect(undo(state, dispatch)).toBe(true)
    expect(
      Array.from(
        { length: state.doc.childCount },
        (_, index) => state.doc.child(index).attrs["id"],
      ),
    ).toEqual(["a", "b", "c"])
  })

  it("requires explicit expansion before wrapping a disconnected selection", () => {
    const profile = createWorkspaceProfile(0)
    const documentType = profile.schema.nodes["doc"]
    const paragraphType = profile.schema.nodes["paragraph"]
    const sectionType = profile.schema.nodes["section"]
    if (documentType === undefined || paragraphType === undefined || sectionType === undefined)
      throw new TypeError("Workspace wrapping schema is incomplete")
    const block = (id: string) => paragraphType.create({ id, locked: false })
    const state = EditorState.create({
      schema: profile.schema,
      doc: documentType.create(undefined, [block("a"), block("b"), block("c")]),
    })

    const plan = planBlockWrap(state.doc, ["a", "c"])

    expect(plan.kind).toBe("expanded")
    if (plan.kind !== "expanded") return
    expect(plan.additionalIds).toEqual(["b"])
    expect(wrapBlocksById(["a", "c"], sectionType)(state)).toBe(false)
    expect(wrapBlocksById(plan.coveredIds, sectionType)(state)).toBe(true)
  })

  it("rejects wrapping when the connected cover contains a locked subtree", () => {
    const profile = createWorkspaceProfile(0)
    const documentType = profile.schema.nodes["doc"]
    const paragraphType = profile.schema.nodes["paragraph"]
    const calloutType = profile.schema.nodes["callout"]
    if (documentType === undefined || paragraphType === undefined || calloutType === undefined)
      throw new TypeError("Workspace wrapping schema is incomplete")
    const state = EditorState.create({
      schema: profile.schema,
      doc: documentType.create(undefined, [
        paragraphType.create({ id: "a", locked: false }),
        paragraphType.create({ id: "locked", locked: true }),
        paragraphType.create({ id: "c", locked: false }),
      ]),
    })

    expect(planBlockWrap(state.doc, ["a", "c"])).toEqual({
      kind: "invalid",
      reason: "locked",
      ids: ["locked"],
    })
    expect(wrapBlocksById(["a", "locked", "c"], calloutType)(state)).toBe(false)
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

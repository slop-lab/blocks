import { Slice } from "prosemirror-model"
import { NodeSelection, TextSelection } from "prosemirror-state"
import { describe, expect, it } from "vitest"
import type { BlockDocument } from "../src/core/types"
import { freshenPastedSlice } from "../src/pm/clipboard"
import { deleteBlock, setType } from "../src/pm/commands"
import { changeEventFrom, createEditorState } from "../src/pm/editor"
import { pmToSnapshot, snapshotToPm } from "../src/pm/snapshot"

const textDocument = (locked = false): BlockDocument => ({
  format: "block-editor/v0.3",
  blocks: [
    {
      id: "alpha",
      type: "paragraph",
      attrs: { extension: "preserved" },
      content: [{ kind: "text", text: "abcd", marks: [] }],
      ...(locked ? { locked: true } : {}),
    },
  ],
})

describe("transaction invariants", () => {
  it("rejects document changes in readonly state", () => {
    const state = createEditorState({ document: snapshotToPm(textDocument()), readonly: true })

    const result = state.applyTransaction(state.tr.insertText("x", 2))

    expect(result.transactions).toHaveLength(0)
    expect(pmToSnapshot(result.state.doc)).toEqual(textDocument())
  })

  it("rejects one mixed transaction that destroys a locked block", () => {
    const document: BlockDocument = {
      format: "block-editor/v0.3",
      blocks: [
        { id: "open", type: "paragraph", attrs: {}, content: [] },
        { id: "locked", type: "paragraph", attrs: {}, content: [], locked: true },
      ],
    }
    const state = createEditorState({ document: snapshotToPm(document), readonly: false })

    const result = state.applyTransaction(state.tr.delete(0, state.doc.content.size))

    expect(result.transactions).toHaveLength(0)
    expect(pmToSnapshot(result.state.doc)).toEqual(document)
  })

  it("keeps the original ID on split and type change while assigning the split a fresh ID", () => {
    const initial = createEditorState({ document: snapshotToPm(textDocument()), readonly: false })
    const split = initial.apply(initial.tr.split(3))
    let typed = split
    const selection = TextSelection.create(split.doc, 1)

    setType("heading", { level: 2 })(
      split.apply(split.tr.setSelection(selection)),
      (transaction) => {
        typed = split.apply(transaction)
      },
    )

    const blocks = pmToSnapshot(typed.doc).blocks
    expect(blocks[0]?.id).toBe("alpha")
    expect(blocks[0]?.type).toBe("heading")
    expect(blocks[0]?.attrs["extension"]).toBe("preserved")
    expect(blocks[1]?.id).not.toBe("alpha")
    expect(new Set(blocks.map((block) => block.id)).size).toBe(2)
  })

  it("deletes the atom selected by NodeSelection rather than the first block", () => {
    const document: BlockDocument = {
      format: "block-editor/v0.3",
      blocks: [
        { id: "first", type: "paragraph", attrs: {}, content: [] },
        { id: "task", type: "task_card", attrs: { taskId: "T-1" }, content: [] },
      ],
    }
    const initial = createEditorState({ document: snapshotToPm(document), readonly: false })
    const taskPosition = initial.doc.child(0).nodeSize
    const selected = initial.apply(
      initial.tr.setSelection(NodeSelection.create(initial.doc, taskPosition)),
    )
    let result = selected

    deleteBlock(selected, (transaction) => {
      result = selected.apply(transaction)
    })

    expect(pmToSnapshot(result.doc).blocks.map((block) => block.id)).toEqual(["first"])
  })
})

describe("clipboard and event metadata", () => {
  it("freshens pasted IDs and remaps only declared block references", () => {
    const source: BlockDocument = {
      format: "block-editor/v0.3",
      blocks: [
        { id: "task", type: "task_card", attrs: { taskId: "T-1" }, content: [] },
        {
          id: "caption",
          type: "caption",
          attrs: { refBlockId: "task", otherBlockId: "task" },
          content: [],
        },
      ],
    }
    const pm = snapshotToPm(source)
    const pasted = freshenPastedSlice(new Slice(pm.content, 0, 0), (id) => `fresh-${id}`)
    const output = pmToSnapshot(pm.type.create(null, pasted.content))

    expect(output.blocks.map((block) => block.id)).toEqual(["fresh-task", "fresh-caption"])
    expect(output.blocks[1]?.attrs).toEqual({
      refBlockId: "fresh-task",
      otherBlockId: "task",
    })
  })

  it("freshens the identity stored inside an opaque copied block", () => {
    const source: BlockDocument = {
      format: "block-editor/v0.3",
      blocks: [
        {
          id: "vendor",
          type: "vendor.diagram",
          attrs: { payload: 3, refBlockId: "vendor" },
          content: [{ kind: "opaque", raw: { points: [1, 2] } }],
        },
      ],
    }
    const pm = snapshotToPm(source)

    const pasted = freshenPastedSlice(new Slice(pm.content, 0, 0), (id) => `fresh-${id}`)
    const output = pmToSnapshot(pm.type.create(null, pasted.content))

    expect(output.blocks[0]).toEqual({ ...source.blocks[0], id: "fresh-vendor" })
  })

  it("reports explicit and history transaction origins accurately", () => {
    const state = createEditorState({ document: snapshotToPm(textDocument()), readonly: false })
    const review = state.tr
      .insertText("x", 2)
      .setMeta("origin", "review")
      .setMeta("modelId", "document-1")
      .setMeta("causeId", "review-7")
      .setMeta("patch", { inserted: "x" })
    const history = state.tr.insertText("y", 2).setMeta("history$", { redo: false })

    expect(changeEventFrom(review, 3, 1)).toMatchObject({
      origin: "review",
      beforeVersion: 3,
      version: 4,
      modelId: "document-1",
      causeId: "review-7",
      patch: { inserted: "x" },
    })
    expect(changeEventFrom(history, 3, 1).origin).toBe("history")
  })

  it("serializes a link mark created by the editor with its href", () => {
    // Given
    const state = createEditorState({ document: snapshotToPm(textDocument()), readonly: false })
    const link = state.schema.marks["link"]
    if (link === undefined) throw new TypeError("Link mark is missing")

    // When
    const linked = state.apply(state.tr.addMark(1, 5, link.create({ href: "/relative" })))

    // Then
    expect(pmToSnapshot(linked.doc).blocks[0]?.content[0]).toMatchObject({
      marks: [{ type: "link", attrs: { href: "/relative" } }],
    })
  })

  it("reports only modified IDs and retains IDs removed by a transaction", () => {
    const document: BlockDocument = {
      format: "block-editor/v0.3",
      blocks: [
        { id: "removed", type: "paragraph", attrs: {}, content: [] },
        { id: "untouched", type: "paragraph", attrs: {}, content: [] },
      ],
    }
    const state = createEditorState({ document: snapshotToPm(document), readonly: false })
    const transaction = state.tr.delete(0, state.doc.child(0).nodeSize)

    expect(changeEventFrom(transaction, 0, 1).changedBlockIds).toEqual(["removed"])
  })
})

import type { BlockRenderer } from "@slop-lab/blocks"
import { BlockViewer } from "@slop-lab/blocks/viewer"
import {
  type BlockRegistration,
  blockAttrs,
  createProseMirrorProfile,
  pmToSnapshot,
  snapshotToPm,
} from "@slop-lab/blocks-prosemirror"
import { baseKeymap } from "prosemirror-commands"
import { TextSelection } from "prosemirror-state"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { createBlockAfter } from "../src/pm/block-interaction-commands"
import { ModelSession } from "../src/pm/session"

const notesText: BlockRegistration = {
  type: "notes.text",
  nodeName: "notes_text",
  text: true,
  nodeSpec: {
    group: "block",
    content: "inline*",
    attrs: blockAttrs,
    toDOM: (node) => ["p", { "data-block-id": node.attrs["id"] }, 0],
  },
  render: (block) => (
    <p data-notes-text="true">
      {block.content.flatMap((inline) => (inline.kind === "text" ? [inline.text] : []))}
    </p>
  ),
}

it("assembles a custom text-only schema without a paragraph node", () => {
  const profile = createProseMirrorProfile([notesText], "notes.text")
  const document = {
    format: "block-editor/v0.3" as const,
    blocks: [
      {
        id: "custom",
        type: "notes.text",
        attrs: {},
        content: [{ kind: "text" as const, text: "사용자 메모", marks: [] }],
      },
    ],
  }

  expect(profile.schema.nodes["paragraph"]).toBeUndefined()
  expect(pmToSnapshot(snapshotToPm(document, profile), profile)).toEqual(document)
})

it("preserves an unknown block byte-for-byte through the opaque adapter", () => {
  const profile = createProseMirrorProfile([notesText], "notes.text")
  const unknown = {
    id: "vendor",
    type: "vendor.diagram",
    attrs: { points: [1, 2] },
    content: [{ kind: "opaque" as const, raw: { edge: "x" } }],
    extension: { version: 7 },
  }
  const document = { format: "block-editor/v0.3" as const, blocks: [unknown] }

  expect(pmToSnapshot(snapshotToPm(document, profile), profile)).toEqual(document)
})

it("uses the configured default text block for Enter and plus insertion", () => {
  const profile = createProseMirrorProfile([notesText], "notes.text")
  const document = {
    format: "block-editor/v0.3" as const,
    blocks: [
      {
        id: "custom",
        type: "notes.text",
        attrs: {},
        content: [{ kind: "text" as const, text: "가나다", marks: [] }],
      },
    ],
  }
  const session = new ModelSession({
    modelId: "notes",
    document,
    epoch: 1,
    version: 0,
    readOnly: false,
    profile,
  })
  session.dispatch(session.state.tr.setSelection(TextSelection.create(session.state.doc, 2)))

  expect(baseKeymap["Enter"]?.(session.state, (transaction) => session.dispatch(transaction))).toBe(
    true,
  )
  expect(
    createBlockAfter(session.snapshot.blocks[1]?.id ?? "")(session.state, (transaction) =>
      session.dispatch(transaction),
    ),
  ).toBe(true)
  expect(session.snapshot.blocks).toHaveLength(3)
  expect(session.snapshot.blocks.every((block) => block.type === "notes.text")).toBe(true)
})

it("renders only explicitly supplied block renderers", () => {
  const document = {
    format: "block-editor/v0.3" as const,
    blocks: [
      {
        id: "custom",
        type: "notes.text",
        attrs: {},
        content: [{ kind: "text" as const, text: "보기 전용", marks: [] }],
      },
    ],
  }
  const renderer = notesText.render
  if (renderer === undefined) throw new TypeError("Missing notes renderer")
  const html = renderToStaticMarkup(
    <BlockViewer content={document} renderers={new Map([[notesText.type, renderer]])} />,
  )

  expect(html).toContain("data-notes-text")
  expect(html).not.toContain("contenteditable")
  expect(html).not.toContain("ProseMirror")
})

it("keeps external view titles out of the canonical content snapshot", () => {
  const document = {
    format: "block-editor/v0.3" as const,
    blocks: [{ id: "task", type: "task.reference", attrs: { taskId: "TASK-9" }, content: [] }],
  }
  const before = JSON.stringify(document)
  const renderer: BlockRenderer = (_block, data) => (
    <h3>{typeof data === "string" ? data : "missing"}</h3>
  )

  const html = renderToStaticMarkup(
    <BlockViewer
      content={document}
      renderers={new Map([["task.reference", renderer]])}
      viewData={new Map([["task", "외부 작업 제목"]])}
    />,
  )

  expect(html).toContain("외부 작업 제목")
  expect(JSON.stringify(document)).toBe(before)
  expect(before).not.toContain("외부 작업 제목")
})

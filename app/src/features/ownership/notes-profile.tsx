import type { BlockRenderer } from "@slop-lab/blocks"
import {
  type BlockRegistration,
  blockAttrs,
  createProseMirrorProfile,
} from "@slop-lab/blocks-prosemirror"

const textRenderer: BlockRenderer = (block) => (
  <p>{block.content.flatMap((inline) => (inline.kind === "text" ? [inline.text] : []))}</p>
)

export const notesTextBlock: BlockRegistration = {
  type: "notes.text",
  nodeName: "notes_text",
  text: true,
  insertMenu: [{ label: "본문", description: "노트 텍스트", keywords: ["문단", "text"] }],
  nodeSpec: {
    group: "block",
    content: "inline*",
    attrs: blockAttrs,
    toDOM: (node) => ["p", { "data-block-id": node.attrs["id"] }, 0],
  },
  render: textRenderer,
}

export const notesCalloutBlock: BlockRegistration = {
  type: "notes.callout",
  nodeName: "notes_callout",
  text: true,
  insertMenu: [{ label: "콜아웃", description: "강조 노트", keywords: ["callout", "강조"] }],
  nodeSpec: {
    group: "block",
    content: "inline*",
    attrs: blockAttrs,
    toDOM: (node) => ["aside", { "data-block-id": node.attrs["id"], class: "notes-callout" }, 0],
  },
  render: (block) => <aside className="notes-callout">{textRenderer(block, undefined)}</aside>,
}

export const notesProfile = createProseMirrorProfile(
  [notesTextBlock, notesCalloutBlock],
  "notes.text",
)

import type { BlockRenderer } from "@block-editor/model"
import {
  type BlockRegistration,
  blockAttrs,
  createProseMirrorProfile,
} from "@block-editor/prosemirror"

const textRenderer: BlockRenderer = (block) => (
  <p>{block.content.flatMap((inline) => (inline.kind === "text" ? [inline.text] : []))}</p>
)

export const notesTextBlock: BlockRegistration = {
  type: "notes.text",
  nodeName: "notes_text",
  text: true,
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

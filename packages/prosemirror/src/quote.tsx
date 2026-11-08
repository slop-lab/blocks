import { renderInline } from "./render.js"
import { blockAttrs } from "./schema.js"
import type { BlockRegistration } from "./types.js"

export const quoteBlock: BlockRegistration = {
  type: "quote",
  nodeName: "blockquote",
  text: true,
  insertMenu: [{ label: "Quote", description: "Quoted text", keywords: ["quote"] }],
  nodeSpec: {
    group: "block",
    content: "inline*",
    attrs: blockAttrs,
    toDOM: (node) => ["blockquote", { "data-block-id": node.attrs["id"] }, 0],
  },
  render: (block) => <blockquote>{renderInline(block)}</blockquote>,
}

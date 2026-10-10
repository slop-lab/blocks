import { blockAttrs } from "./schema.js"
import type { BlockRegistration } from "./types.js"
import { renderInline } from "./render.js"

export const paragraphBlock: BlockRegistration = {
  type: "paragraph",
  nodeName: "paragraph",
  text: true,
  nodeSpec: {
    group: "block",
    content: "inline*",
    attrs: blockAttrs,
    toDOM: (node) => ["p", { "data-block-id": node.attrs["id"], "data-locked": node.attrs["locked"] }, 0],
  },
  render: (block) => <p>{renderInline(block)}</p>,
}

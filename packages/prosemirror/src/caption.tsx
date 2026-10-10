import { renderInline } from "./render.js"
import { blockAttrs } from "./schema.js"
import type { BlockRegistration } from "./types.js"

export const captionBlock: BlockRegistration = {
  type: "caption",
  nodeName: "caption",
  text: true,
  referenceAttrs: ["refBlockId"],
  nodeSpec: {
    group: "block",
    content: "inline*",
    attrs: { ...blockAttrs, refBlockId: { default: "" } },
    toDOM: (node) => ["figcaption", { "data-block-id": node.attrs["id"] }, 0],
  },
  render: (block) => <p>{renderInline(block)}</p>,
}

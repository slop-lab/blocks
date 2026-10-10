import { createElement } from "react"
import { blockAttrs } from "./schema.js"
import type { BlockRegistration } from "./types.js"
import { renderInline } from "./render.js"

export const headingBlock: BlockRegistration = {
  type: "heading",
  nodeName: "heading",
  text: true,
  nodeSpec: {
    group: "block",
    content: "inline*",
    attrs: { ...blockAttrs, level: { default: 2 } },
    toDOM: (node) => [`h${String(node.attrs["level"])}`, { "data-block-id": node.attrs["id"] }, 0],
  },
  render: (block) => {
    const raw = block.attrs["level"]
    const level = typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 6 ? raw : 2
    return createElement(`h${level}`, null, renderInline(block))
  },
}

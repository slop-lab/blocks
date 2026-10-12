import { createElement } from "react"
import { renderInline } from "./render.js"
import { blockAttrs } from "./schema.js"
import type { BlockRegistration } from "./types.js"

export const headingBlock: BlockRegistration = {
  type: "heading",
  nodeName: "heading",
  text: true,
  insertMenu: [1, 2, 3].map((level) => ({
    label: `제목 ${level}`,
    description: `${level}단계 제목`,
    keywords: ["제목", "heading", `h${level}`],
    attrs: { level },
  })),
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

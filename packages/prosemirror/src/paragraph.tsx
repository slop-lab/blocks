import { renderInline } from "./render.js"
import { blockAttrs } from "./schema.js"
import type { BlockRegistration } from "./types.js"

export const paragraphBlock: BlockRegistration = {
  type: "paragraph",
  nodeName: "paragraph",
  text: true,
  insertMenu: [{ label: "본문", description: "일반 텍스트", keywords: ["문단", "text"] }],
  nodeSpec: {
    group: "block",
    content: "inline*",
    attrs: blockAttrs,
    toDOM: (node) => [
      "p",
      { "data-block-id": node.attrs["id"], "data-locked": node.attrs["locked"] },
      0,
    ],
  },
  render: (block) => <p>{renderInline(block)}</p>,
}

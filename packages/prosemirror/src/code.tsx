import { renderInline } from "./render.js"
import { blockAttrs } from "./schema.js"
import type { BlockRegistration } from "./types.js"

export const codeBlock: BlockRegistration = {
  type: "code",
  nodeName: "code_block",
  text: true,
  insertMenu: [{ label: "Code block", description: "Unformatted code", keywords: ["code"] }],
  nodeSpec: {
    group: "block",
    content: "text*",
    marks: "",
    code: true,
    attrs: blockAttrs,
    toDOM: (node) => ["pre", { "data-block-id": node.attrs["id"] }, ["code", 0]],
  },
  render: (block) => (
    <pre>
      <code>{renderInline(block)}</code>
    </pre>
  ),
}

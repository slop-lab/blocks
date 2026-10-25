import { renderInline } from "./render.js"
import { blockAttrs } from "./schema.js"
import type { BlockRegistration } from "./types.js"

export const taskCardBlock: BlockRegistration = {
  type: "task_card",
  nodeName: "task_card",
  text: false,
  nodeSpec: {
    group: "block",
    atom: true,
    selectable: true,
    attrs: {
      ...blockAttrs,
      taskId: { default: "" },
      title: { default: "" },
      status: { default: "open" },
    },
    toDOM: (node) => ["div", { "data-block-id": node.attrs["id"], "data-task-card": "true" }],
  },
  render: (block) => (
    <section>
      <strong>{String(block.attrs["title"] ?? "Task")}</strong>
      {renderInline(block)}
    </section>
  ),
}

import type { BlockRenderer } from "@slop-lab/blocks"
import {
  type BlockRegistration,
  blockAttrs,
  createProseMirrorProfile,
} from "@slop-lab/blocks-prosemirror"

const text = (block: Parameters<BlockRenderer>[0]) =>
  block.content.flatMap((inline) => (inline.kind === "text" ? [inline.text] : [])).join("")

const statusLabels: Readonly<Record<string, string>> = {
  running: "In progress",
  done: "Done",
}

export const captionBlock: BlockRegistration = {
  type: "ownership.caption",
  nodeName: "ownership_caption",
  text: true,
  insertMenu: [
    { label: "Text", description: "Presentation description", keywords: ["paragraph", "text"] },
  ],
  nodeSpec: {
    group: "block",
    content: "inline*",
    attrs: blockAttrs,
    toDOM: (node) => ["p", { "data-block-id": node.attrs["id"], class: "ownership-caption" }, 0],
  },
  render: (block) => <p className="ownership-caption">{text(block)}</p>,
}

export const taskCardBlock: BlockRegistration = {
  type: "ownership.task-card",
  nodeName: "ownership_task_card",
  text: true,
  referenceAttrs: ["taskId"],
  nodeSpec: {
    group: "block",
    content: "inline*",
    attrs: { ...blockAttrs, taskId: { default: "" } },
    toDOM: (node) => ["article", { "data-block-id": node.attrs["id"], class: "ownership-card" }, 0],
  },
  render: (block, data) => {
    const task = typeof data === "object" && data !== null && "title" in data ? data : null
    return (
      <article className="ownership-card">
        <small>Linked task · {String(block.attrs["taskId"] ?? "Unknown")}</small>
        <h3>{task === null ? "Deleted task" : String(task.title)}</h3>
        <p>{text(block)}</p>
        {task !== null && "status" in task && (
          <span className="status-badge">
            {statusLabels[String(task.status)] ?? String(task.status)}
          </span>
        )}
      </article>
    )
  },
}

export const presentationProfile = createProseMirrorProfile(
  [captionBlock, taskCardBlock],
  "ownership.caption",
)

export const presentationRenderers = new Map(
  [captionBlock, taskCardBlock].map((block) => [block.type, block.render ?? (() => null)]),
)

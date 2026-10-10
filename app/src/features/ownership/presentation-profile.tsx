import type { BlockRenderer } from "@block-editor/model"
import {
  type BlockRegistration,
  blockAttrs,
  createProseMirrorProfile,
} from "@block-editor/prosemirror"

const text = (block: Parameters<BlockRenderer>[0]) =>
  block.content.flatMap((inline) => (inline.kind === "text" ? [inline.text] : [])).join("")

export const captionBlock: BlockRegistration = {
  type: "ownership.caption",
  nodeName: "ownership_caption",
  text: true,
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
        <small>{String(block.attrs["taskId"] ?? "")}</small>
        <h3>{task === null ? "삭제된 작업" : String(task.title)}</h3>
        <p>{text(block)}</p>
        {task !== null && "status" in task && (
          <span className="status-badge">{String(task.status)}</span>
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

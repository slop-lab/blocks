import type { BlockRenderer } from "@block-editor/model"

export const paragraphRenderer: BlockRenderer = (block) => (
  <p>{block.content.flatMap((inline) => (inline.kind === "text" ? [inline.text] : []))}</p>
)

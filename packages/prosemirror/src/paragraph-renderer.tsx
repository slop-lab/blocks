import type { BlockRenderer } from "@slop-lab/blocks"

export const paragraphRenderer: BlockRenderer = (block) => (
  <p>{block.content.flatMap((inline) => (inline.kind === "text" ? [inline.text] : []))}</p>
)

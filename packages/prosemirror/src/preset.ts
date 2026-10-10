import { captionBlock } from "./caption.js"
import { codeBlock } from "./code.js"
import { headingBlock } from "./heading.js"
import { paragraphBlock } from "./paragraph.js"
import { quoteBlock } from "./quote.js"
import { createProseMirrorProfile } from "./schema.js"
import { taskCardBlock } from "./task-card.js"

export const defaultBlocks = [
  paragraphBlock,
  headingBlock,
  quoteBlock,
  codeBlock,
  captionBlock,
  taskCardBlock,
] as const

export const defaultProfile = createProseMirrorProfile(defaultBlocks, "paragraph")

import type { BlockDocument, BlockSnapshot, InlineSnapshot } from "./types"

export type ProjectionLimits = { readonly maxBlocks: number; readonly maxText: number }
export type Loss = { readonly blockId: string; readonly reason: string }

const textOf = (content: readonly InlineSnapshot[]): string =>
  content.map((inline) => (inline.kind === "text" ? inline.text : "[opaque inline]")).join("")

const bounded = (document: BlockDocument, limits: ProjectionLimits): readonly BlockSnapshot[] => {
  if (document.blocks.length > limits.maxBlocks)
    throw new RangeError("Block read exceeds configured bound")
  const total = document.blocks.reduce((size, block) => size + textOf(block.content).length, 0)
  if (total > limits.maxText) throw new RangeError("Text read exceeds configured bound")
  return document.blocks
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

const headingLevel = (block: BlockSnapshot) => {
  const level = block.attrs["level"]
  return typeof level === "number" && Number.isInteger(level) && level >= 1 && level <= 6
    ? level
    : 2
}

const reportLoss = (block: BlockSnapshot, losses: Loss[]) => {
  const reasons: string[] = []
  if (Object.keys(block.attrs).some((key) => key !== "level"))
    reasons.push("presentation attributes omitted")
  if (block.content.some((inline) => inline.kind === "opaque"))
    reasons.push("opaque inline rendered as placeholder")
  if (block.content.some((inline) => inline.kind === "text" && inline.marks.length > 0))
    reasons.push("inline marks omitted in plain projection")
  if (reasons.length > 0) losses.push({ blockId: block.id, reason: reasons.join("; ") })
}

export type ReadBudget = {
  readonly maxBlocks: number
  readonly maxBytes: number
  readonly cursor?: number
}

export const readBlocks = (document: BlockDocument, budget: ReadBudget) => {
  const start = budget.cursor ?? 0
  if (
    ![start, budget.maxBlocks, budget.maxBytes].every(Number.isSafeInteger) ||
    start < 0 ||
    start > document.blocks.length ||
    budget.maxBlocks < 1 ||
    budget.maxBytes < 1
  )
    throw new RangeError("Invalid read budget or cursor")
  const blocks: BlockSnapshot[] = []
  let bytes = 0
  let cursor = start
  for (const block of document.blocks.slice(start)) {
    const size = new TextEncoder().encode(JSON.stringify(block)).byteLength
    if (blocks.length === budget.maxBlocks || bytes + size > budget.maxBytes) break
    blocks.push(block)
    bytes += size
    cursor += 1
  }
  return {
    blocks,
    bytes,
    omitted: cursor < document.blocks.length,
    nextCursor: cursor < document.blocks.length ? cursor : null,
    budgetExceeded: blocks.length === 0 && cursor < document.blocks.length,
    fullyLoaded: true,
  }
}

export const readOutline = (document: BlockDocument, limits: ProjectionLimits) => ({
  items: bounded(document, limits)
    .filter((block) => block.type === "heading")
    .map((block) => ({
      id: block.id,
      level: block.attrs["level"] ?? 1,
      text: textOf(block.content),
    })),
})

export const exportHtml = (document: BlockDocument, limits: ProjectionLimits) => {
  const losses: Loss[] = []
  const output = bounded(document, limits)
    .map((block) => {
      const text = escapeHtml(textOf(block.content))
      reportLoss(block, losses)
      if (block.type === "heading")
        return `<h${headingLevel(block)}>${text}</h${headingLevel(block)}>`
      if (block.type === "paragraph") return `<p>${text}</p>`
      if (block.type === "quote") return `<blockquote>${text}</blockquote>`
      losses.push({ blockId: block.id, reason: `Rendered ${block.type} as inert opaque section` })
      return `<section data-block-type="${escapeHtml(block.type)}"><pre>${text}</pre></section>`
    })
    .join("\n")
  return { output, losses }
}

export const exportMarkdown = (document: BlockDocument, limits: ProjectionLimits) => {
  const losses: Loss[] = []
  const output = bounded(document, limits)
    .map((block) => {
      const text = textOf(block.content)
      reportLoss(block, losses)
      if (block.type === "heading") return `${"#".repeat(headingLevel(block))} ${text}`
      if (block.type === "paragraph") return text
      if (block.type === "quote") return `> ${text}`
      losses.push({ blockId: block.id, reason: `Serialized ${block.type} as fenced opaque data` })
      return `\`\`\`block:${block.type}\n${text}\n\`\`\``
    })
    .join("\n\n")
  return { output, losses }
}

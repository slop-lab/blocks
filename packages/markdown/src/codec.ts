import MarkdownIt from "markdown-it"
import {
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  MarkdownParser,
} from "prosemirror-markdown"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import { markdownSchema } from "./schema.js"

type ParsedMarkdown = {
  readonly document: ProseMirrorNode
  readonly schema: typeof markdownSchema
}

type SourceRange = {
  readonly start: number
  readonly end: number
  readonly supported: boolean
  readonly label: string
}

const tokenizer = new MarkdownIt({ html: true, linkify: true, typographer: false })
const parser = new MarkdownParser(markdownSchema, tokenizer, defaultMarkdownParser.tokens)
const supportedTokens = new Set([
  "paragraph_open",
  "heading_open",
  "blockquote_open",
  "bullet_list_open",
  "ordered_list_open",
  "fence",
  "code_block",
  "hr",
])

const lineStarts = (source: string): readonly number[] => {
  const starts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1)
  }
  starts.push(source.length)
  return starts
}

const topLevelRanges = (source: string): readonly SourceRange[] => {
  const starts = lineStarts(source)
  const ranges: SourceRange[] = []
  for (const token of tokenizer.parse(source, {})) {
    if (token.level !== 0 || token.map === null || token.nesting === -1) continue
    const start = starts[token.map[0]] ?? source.length
    const end = starts[token.map[1]] ?? source.length
    const raw = source.slice(start, end)
    const directive = raw.trimStart().startsWith(":::")
    ranges.push({
      start,
      end,
      supported: supportedTokens.has(token.type) && !directive,
      label: token.type.startsWith("table") ? "Markdown 표" : "지원하지 않는 Markdown",
    })
  }
  return ranges.filter(
    (range, index) => index === 0 || range.start >= (ranges[index - 1]?.end ?? 0),
  )
}

const canonical = (node: ProseMirrorNode): string => {
  if (node.type.name === "opaque") return String(node.attrs["raw"])
  return defaultMarkdownSerializer.serialize(markdownSchema.topNodeType.create(null, [node]))
}

const withSource = (node: ProseMirrorNode, raw: string, prefixRaw: string): ProseMirrorNode => {
  const fingerprint = canonical(node)
  return node.type.create(
    {
      ...node.attrs,
      id: crypto.randomUUID(),
      originalRaw: raw,
      originalFingerprint: fingerprint,
      prefixRaw,
      locked: false,
    },
    node.content,
    node.marks,
  )
}

const opaque = (raw: string, prefixRaw: string, label: string): ProseMirrorNode =>
  markdownSchema.nodes["opaque"]?.create({
    id: crypto.randomUUID(),
    originalRaw: raw,
    originalFingerprint: raw,
    prefixRaw,
    locked: true,
    raw,
    label,
  }) ?? markdownSchema.node("paragraph")

export const parseMarkdown = (source: string): ParsedMarkdown => {
  const content: ProseMirrorNode[] = []
  let cursor = 0
  let prefix = ""
  for (const range of topLevelRanges(source)) {
    const gap = source.slice(cursor, range.start)
    if (gap.trim().length === 0) prefix += gap
    else {
      content.push(opaque(gap, prefix, "보존된 참조 또는 확장 구문"))
      prefix = ""
    }
    const raw = source.slice(range.start, range.end)
    if (range.supported) {
      const parsed = parser.parse(raw)
      const node = parsed.childCount === 1 ? parsed.firstChild : null
      if (node === null) content.push(opaque(raw, prefix, range.label))
      else content.push(withSource(node, raw, prefix))
    } else content.push(opaque(raw, prefix, range.label))
    prefix = ""
    cursor = range.end
  }
  const tail = source.slice(cursor)
  if (tail.trim().length === 0) prefix += tail
  else {
    content.push(opaque(tail, prefix, "보존된 참조 또는 확장 구문"))
    prefix = ""
  }
  if (content.length === 0) {
    const paragraph = markdownSchema.nodes["paragraph"]?.create()
    if (paragraph !== undefined) content.push(withSource(paragraph, "", ""))
  }
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n"
  return {
    document: markdownSchema.topNodeType.create({ suffixRaw: prefix, lineEnding }, content),
    schema: markdownSchema,
  }
}

const canonicalWithEnding = (node: ProseMirrorNode, lineEnding: string): string => {
  const output = canonical(node).replace(/\n/g, lineEnding)
  const raw = node.attrs["originalRaw"]
  return typeof raw === "string" && /(?:\r?\n)$/u.test(raw) && !output.endsWith(lineEnding)
    ? output + lineEnding
    : output
}

export const serializeMarkdown = (document: ProseMirrorNode): string => {
  const ending = document.attrs["lineEnding"] === "\r\n" ? "\r\n" : "\n"
  let output = ""
  document.forEach((node) => {
    const prefix = node.attrs["prefixRaw"]
    output += typeof prefix === "string" ? prefix : ""
    if (node.type.name === "opaque") {
      output += String(node.attrs["raw"])
      return
    }
    const original = node.attrs["originalRaw"]
    const fingerprint = node.attrs["originalFingerprint"]
    output +=
      typeof original === "string" && fingerprint === canonical(node)
        ? original
        : canonicalWithEnding(node, ending)
  })
  const suffix = document.attrs["suffixRaw"]
  return output + (typeof suffix === "string" ? suffix : "")
}

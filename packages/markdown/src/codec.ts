import MarkdownIt from "markdown-it"
import type Token from "markdown-it/lib/token.mjs"
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

type SourceScan = {
  readonly environment: Record<string, unknown>
  readonly ranges: readonly SourceRange[]
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
const compatibleTokens = new Set([
  "blockquote_open",
  "blockquote_close",
  "paragraph_open",
  "paragraph_close",
  "list_item_open",
  "list_item_close",
  "bullet_list_open",
  "bullet_list_close",
  "ordered_list_open",
  "ordered_list_close",
  "heading_open",
  "heading_close",
  "code_block",
  "fence",
  "hr",
  "inline",
  "text",
  "softbreak",
  "hardbreak",
  "em_open",
  "em_close",
  "strong_open",
  "strong_close",
  "link_open",
  "link_close",
  "code_inline",
  "image",
])

const lineStarts = (source: string): readonly number[] => {
  const starts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1)
  }
  starts.push(source.length)
  return starts
}

const compatible = (tokens: readonly Token[]): boolean =>
  tokens.every(
    (token) =>
      compatibleTokens.has(token.type) && (token.children === null || compatible(token.children)),
  )

const scanSource = (source: string): SourceScan => {
  const starts = lineStarts(source)
  const ranges: SourceRange[] = []
  const environment: Record<string, unknown> = {}
  const tokens = tokenizer.parse(source, environment)
  const candidates = tokens
    .map((token, index) => ({ token, index }))
    .filter(({ token }) => token.level === 0 && token.map !== null && token.nesting !== -1)
  for (const [candidateIndex, candidate] of candidates.entries()) {
    const { token, index } = candidate
    if (token.level !== 0 || token.map === null || token.nesting === -1) continue
    const start = starts[token.map[0]] ?? source.length
    const end = starts[token.map[1]] ?? source.length
    const raw = source.slice(start, end)
    const directive = raw.trimStart().startsWith(":::")
    const nextIndex = candidates[candidateIndex + 1]?.index ?? tokens.length
    ranges.push({
      start,
      end,
      supported:
        supportedTokens.has(token.type) && !directive && compatible(tokens.slice(index, nextIndex)),
      label: token.type.startsWith("table") ? "Markdown 표" : "지원하지 않는 Markdown",
    })
  }
  return {
    environment,
    ranges: ranges.filter(
      (range, index) => index === 0 || range.start >= (ranges[index - 1]?.end ?? 0),
    ),
  }
}

const canonical = (node: ProseMirrorNode): string => {
  if (node.type.name === "opaque") return String(node.attrs["raw"])
  return defaultMarkdownSerializer.serialize(markdownSchema.topNodeType.create(null, [node]))
}

const withSource = (
  node: ProseMirrorNode,
  raw: string,
  prefixRaw: string,
  sourceOrder: number,
): ProseMirrorNode => {
  const fingerprint = canonical(node)
  return node.type.create(
    {
      ...node.attrs,
      id: crypto.randomUUID(),
      originalRaw: raw,
      originalFingerprint: fingerprint,
      prefixRaw,
      locked: false,
      sourceOrder,
    },
    node.content,
    node.marks,
  )
}

const opaque = (
  raw: string,
  prefixRaw: string,
  label: string,
  sourceOrder: number,
): ProseMirrorNode =>
  markdownSchema.nodes["opaque"]?.create({
    id: crypto.randomUUID(),
    originalRaw: raw,
    originalFingerprint: raw,
    prefixRaw,
    locked: true,
    sourceOrder,
    raw,
    label,
  }) ?? markdownSchema.node("paragraph")

export const parseMarkdown = (source: string): ParsedMarkdown => {
  const content: ProseMirrorNode[] = []
  const scan = scanSource(source)
  let cursor = 0
  let prefix = ""
  for (const range of scan.ranges) {
    const gap = source.slice(cursor, range.start)
    if (gap.trim().length === 0) prefix += gap
    else {
      content.push(opaque(gap, prefix, "보존된 참조 또는 확장 구문", content.length))
      prefix = ""
    }
    const raw = source.slice(range.start, range.end)
    if (range.supported) {
      try {
        const parsed = parser.parse(raw, scan.environment)
        const node = parsed.childCount === 1 ? parsed.firstChild : null
        if (node === null) content.push(opaque(raw, prefix, range.label, content.length))
        else content.push(withSource(node, raw, prefix, content.length))
      } catch (error) {
        if (!(error instanceof RangeError)) throw error
        content.push(opaque(raw, prefix, range.label, content.length))
      }
    } else content.push(opaque(raw, prefix, range.label, content.length))
    prefix = ""
    cursor = range.end
  }
  const tail = source.slice(cursor)
  if (tail.trim().length === 0) prefix += tail
  else {
    content.push(opaque(tail, prefix, "보존된 참조 또는 확장 구문", content.length))
    prefix = ""
  }
  if (content.length === 0) {
    const paragraph = markdownSchema.nodes["paragraph"]?.create()
    if (paragraph !== undefined) content.push(withSource(paragraph, "", "", 0))
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
  let previousOrder: number | null = null
  document.forEach((node, _offset, index) => {
    const prefix = node.attrs["prefixRaw"]
    const order = node.attrs["sourceOrder"]
    const stableBoundary =
      typeof order === "number" &&
      order >= 0 &&
      (index === 0 ? order === 0 : previousOrder !== null && order === previousOrder + 1)
    if (stableBoundary) output += typeof prefix === "string" ? prefix : ""
    else if (index > 0 && !output.endsWith(`${ending}${ending}`))
      output += output.endsWith(ending) ? ending : `${ending}${ending}`
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
    previousOrder = typeof order === "number" && order >= 0 ? order : null
  })
  const suffix = document.attrs["suffixRaw"]
  return output + (typeof suffix === "string" ? suffix : "")
}

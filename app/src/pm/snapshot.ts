import type { Mark, Node as ProseMirrorNode } from "prosemirror-model"
import { DocumentCodecError, decodeDocument } from "../core/codec"
import type { BlockDocument, BlockSnapshot, InlineSnapshot } from "../core/types"
import { editorSchema } from "./schema"

const knownTypes = new Set(["paragraph", "heading", "quote", "code", "caption", "task_card"])
const knownMarks = new Set(["strong", "em", "code", "link"])
const textKeys = new Set(["kind", "text", "marks"])

const isSupportedMark = (raw: unknown): boolean => {
  if (typeof raw !== "object" || raw === null || !("type" in raw)) return false
  if (typeof raw.type !== "string" || !knownMarks.has(raw.type)) return false
  if (raw.type !== "link") return true
  if (!("attrs" in raw) || typeof raw.attrs !== "object" || raw.attrs === null) return false
  return "href" in raw.attrs && typeof raw.attrs.href === "string"
}

const canEdit = (block: BlockSnapshot): boolean => {
  if (!knownTypes.has(block.type)) return false
  if (block.type === "task_card") return block.content.length === 0
  return block.content.every(
    (inline) =>
      inline.kind === "text" &&
      inline.text.length > 0 &&
      Object.keys(inline).every((key) => textKeys.has(key)) &&
      inline.marks.every(isSupportedMark) &&
      (block.type !== "code" || inline.marks.length === 0),
  )
}

const marksFrom = (marks: readonly unknown[]): readonly Mark[] =>
  marks.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null || !("type" in raw)) return []
    if (typeof raw.type !== "string") return []
    const type = editorSchema.marks[raw.type]
    if (type === undefined) return []
    const href =
      "attrs" in raw && typeof raw.attrs === "object" && raw.attrs !== null && "href" in raw.attrs
        ? raw.attrs.href
        : ""
    return [type.create({ snapshot: structuredClone(raw), href })]
  })

const textContent = (content: readonly InlineSnapshot[]) =>
  content.flatMap((inline) =>
    inline.kind === "text" ? [editorSchema.text(inline.text, marksFrom(inline.marks))] : [],
  )

const attrsFor = (block: BlockSnapshot): Readonly<Record<string, unknown>> => {
  const { id, type, attrs, content, locked, ...blockExtras } = block
  void content
  return {
    ...attrs,
    id,
    locked: locked ?? false,
    snapshotAttrs: structuredClone(attrs),
    blockExtras: structuredClone(blockExtras),
    snapshotType: type,
  }
}

const blockToNode = (block: BlockSnapshot): ProseMirrorNode => {
  if (!canEdit(block)) {
    return editorSchema.nodes.opaque.create({
      id: block.id,
      locked: true,
      raw: JSON.stringify(block),
      originalType: block.type,
    })
  }
  const name =
    block.type === "quote" ? "blockquote" : block.type === "code" ? "code_block" : block.type
  const type = editorSchema.nodes[name]
  if (type === undefined) {
    return editorSchema.nodes.opaque.create({
      id: block.id,
      locked: true,
      raw: JSON.stringify(block),
      originalType: block.type,
    })
  }
  return type.create(attrsFor(block), type.isLeaf ? undefined : textContent(block.content))
}

export const snapshotToPm = (document: BlockDocument): ProseMirrorNode => {
  const { format, blocks, ...documentExtras } = document
  void format
  return editorSchema.nodes.doc.create(
    { documentExtras: structuredClone(documentExtras) },
    blocks.map(blockToNode),
  )
}

const markSnapshot = (mark: Mark): unknown => {
  const snapshot = mark.attrs["snapshot"]
  return typeof snapshot === "object" && snapshot !== null
    ? structuredClone(snapshot)
    : { type: mark.type.name }
}

const attrsFromNode = (
  node: ProseMirrorNode,
  mappedType: string,
): Readonly<Record<string, unknown>> => {
  const stored = node.attrs["snapshotAttrs"]
  const attrs = typeof stored === "object" && stored !== null ? { ...stored } : {}
  const snapshotType = node.attrs["snapshotType"]
  const shouldWrite = (name: string): boolean => snapshotType !== mappedType || name in attrs
  if (mappedType === "heading" && shouldWrite("level")) attrs["level"] = node.attrs["level"]
  if (mappedType === "caption" && shouldWrite("refBlockId"))
    attrs["refBlockId"] = node.attrs["refBlockId"]
  if (mappedType === "task_card") {
    for (const name of ["taskId", "title", "status"])
      if (shouldWrite(name)) attrs[name] = node.attrs[name]
  }
  return attrs
}

const nodeToBlock = (node: ProseMirrorNode): BlockSnapshot => {
  if (node.type.name === "opaque") {
    const raw = node.attrs["raw"]
    if (typeof raw === "string") {
      try {
        const wrapped = decodeDocument({ format: "block-editor/v0.3", blocks: [JSON.parse(raw)] })
        const original = wrapped.blocks[0]
        if (original !== undefined) return original
      } catch (error) {
        if (!(error instanceof DocumentCodecError) && !(error instanceof SyntaxError)) throw error
      }
    }
  }
  const content: InlineSnapshot[] = []
  node.content.forEach((child) => {
    if (child.isText)
      content.push({ kind: "text", text: child.text ?? "", marks: child.marks.map(markSnapshot) })
  })
  const mappedType =
    node.type.name === "blockquote"
      ? "quote"
      : node.type.name === "code_block"
        ? "code"
        : node.type.name
  const id = node.attrs["id"]
  const extras = node.attrs["blockExtras"]
  const blockExtras = typeof extras === "object" && extras !== null ? extras : {}
  return {
    ...blockExtras,
    id: typeof id === "string" ? id : crypto.randomUUID(),
    type: mappedType,
    attrs: attrsFromNode(node, mappedType),
    content,
    ...(node.attrs["locked"] === true ? { locked: true } : {}),
  }
}

export const pmToSnapshot = (document: ProseMirrorNode): BlockDocument => {
  const extras = document.attrs["documentExtras"]
  const documentExtras = typeof extras === "object" && extras !== null ? extras : {}
  return {
    ...documentExtras,
    format: "block-editor/v0.3",
    blocks: document.content.content.map(nodeToBlock),
  }
}

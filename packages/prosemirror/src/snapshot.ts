import {
  type BlockDocument,
  type BlockSnapshot,
  DocumentCodecError,
  decodeDocument,
  type InlineSnapshot,
} from "@slop-lab/blocks"
import type { Mark, NodeType, Node as ProseMirrorNode } from "prosemirror-model"
import type { ProseMirrorProfile } from "./types.js"

const textKeys = new Set(["kind", "text", "marks"])
const knownMarks = new Set(["strong", "em", "code", "link"])

const supportedMark = (raw: unknown): boolean => {
  if (typeof raw !== "object" || raw === null || !("type" in raw) || typeof raw.type !== "string")
    return false
  if (!knownMarks.has(raw.type)) return false
  if (raw.type !== "link") return true
  return (
    "attrs" in raw &&
    typeof raw.attrs === "object" &&
    raw.attrs !== null &&
    "href" in raw.attrs &&
    typeof raw.attrs.href === "string"
  )
}

const canEdit = (block: BlockSnapshot, profile: ProseMirrorProfile): boolean => {
  const registration = profile.registrations.get(block.type)
  if (registration === undefined) return false
  if (registration.container !== undefined)
    return (block.children ?? []).every((child) => canEdit(child, profile))
  if (!registration.text) return block.content.length === 0
  return block.content.every(
    (inline) =>
      inline.kind === "text" &&
      inline.text.length > 0 &&
      Object.keys(inline).every((key) => textKeys.has(key)) &&
      inline.marks.every(supportedMark) &&
      (registration.nodeSpec.code !== true || inline.marks.length === 0),
  )
}

const marksFrom = (marks: readonly unknown[], profile: ProseMirrorProfile): readonly Mark[] =>
  marks.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null || !("type" in raw) || typeof raw.type !== "string")
      return []
    const type = profile.schema.marks[raw.type]
    if (type === undefined) return []
    const href =
      "attrs" in raw && typeof raw.attrs === "object" && raw.attrs !== null && "href" in raw.attrs
        ? raw.attrs.href
        : ""
    return [type.create({ snapshot: structuredClone(raw), href })]
  })

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

const requireNode = (profile: ProseMirrorProfile, name: string): NodeType => {
  const node = profile.schema.nodes[name]
  if (node === undefined) throw new TypeError(`Missing ProseMirror node: ${name}`)
  return node
}

const opaqueNode = (block: BlockSnapshot, profile: ProseMirrorProfile): ProseMirrorNode =>
  requireNode(profile, "opaque").create({
    id: block.id,
    locked: true,
    raw: JSON.stringify(block),
    originalType: block.type,
  })

export const snapshotToPm = (
  document: BlockDocument,
  profile: ProseMirrorProfile,
): ProseMirrorNode => {
  const { format, blocks, ...documentExtras } = document
  void format
  const convert = (block: BlockSnapshot): ProseMirrorNode => {
    const registration = profile.registrations.get(block.type)
    if (!canEdit(block, profile) || registration === undefined) return opaqueNode(block, profile)
    const nodeType = profile.schema.nodes[registration.nodeName]
    if (nodeType === undefined) return opaqueNode(block, profile)
    if (registration.container !== undefined) {
      const children: ProseMirrorNode[] = []
      if (registration.container === "titled" && block.content.length > 0) {
        const titleName = registration.titleNodeName
        if (titleName === undefined) throw new TypeError(`Missing title node for ${block.type}`)
        children.push(
          requireNode(profile, titleName).create(
            undefined,
            block.content.flatMap((inline) =>
              inline.kind === "text"
                ? [profile.schema.text(inline.text, marksFrom(inline.marks, profile))]
                : [],
            ),
          ),
        )
      }
      children.push(...(block.children ?? []).map(convert))
      return nodeType.create(attrsFor(block), children)
    }
    const content = block.content.flatMap((inline) =>
      inline.kind === "text"
        ? [profile.schema.text(inline.text, marksFrom(inline.marks, profile))]
        : [],
    )
    return nodeType.create(attrsFor(block), nodeType.isLeaf ? undefined : content)
  }
  return requireNode(profile, "doc").create(
    { documentExtras: structuredClone(documentExtras) },
    blocks.map(convert),
  )
}

const markSnapshot = (mark: Mark): unknown => {
  const snapshot = mark.attrs["snapshot"]
  if (typeof snapshot === "object" && snapshot !== null) return structuredClone(snapshot)
  const href = mark.attrs["href"]
  return mark.type.name === "link" && typeof href === "string"
    ? { type: "link", attrs: { href } }
    : { type: mark.type.name }
}

export const pmToSnapshot = (
  document: ProseMirrorNode,
  profile: ProseMirrorProfile,
): BlockDocument => {
  const extras = document.attrs["documentExtras"]
  const documentExtras = typeof extras === "object" && extras !== null ? extras : {}
  const convert = (node: ProseMirrorNode): BlockSnapshot => {
    if (node.type.name === "opaque") {
      const raw = node.attrs["raw"]
      if (typeof raw === "string") {
        try {
          const original = decodeDocument({
            format: "block-editor/v0.3",
            blocks: [JSON.parse(raw)],
          }).blocks[0]
          if (original !== undefined) return original
        } catch (error) {
          if (!(error instanceof DocumentCodecError) && !(error instanceof SyntaxError)) throw error
        }
      }
    }
    const registration = profile.registrationsByNode.get(node.type.name)
    const mappedType = registration?.type ?? node.type.name
    const stored = node.attrs["snapshotAttrs"]
    const attrs: Record<string, unknown> =
      typeof stored === "object" && stored !== null ? { ...stored } : {}
    for (const name of Object.keys(registration?.nodeSpec.attrs ?? {})) {
      if (!["id", "locked", "snapshotAttrs", "blockExtras", "snapshotType"].includes(name))
        attrs[name] = node.attrs[name]
    }
    const content: InlineSnapshot[] = []
    const children: BlockSnapshot[] = []
    node.content.forEach((child) => {
      if (child.isText)
        content.push({ kind: "text", text: child.text ?? "", marks: child.marks.map(markSnapshot) })
      else if (
        registration?.container === "titled" &&
        child.type.name === registration.titleNodeName
      )
        child.content.forEach((inline) => {
          if (inline.isText)
            content.push({
              kind: "text",
              text: inline.text ?? "",
              marks: inline.marks.map(markSnapshot),
            })
        })
      else if (registration?.container !== undefined) children.push(convert(child))
    })
    const id = node.attrs["id"]
    const blockExtras =
      typeof node.attrs["blockExtras"] === "object" && node.attrs["blockExtras"] !== null
        ? node.attrs["blockExtras"]
        : {}
    return {
      ...blockExtras,
      id: typeof id === "string" ? id : crypto.randomUUID(),
      type: mappedType,
      attrs,
      content,
      ...(registration?.container === undefined ? {} : { children }),
      ...(node.attrs["locked"] === true ? { locked: true } : {}),
    }
  }
  return {
    ...documentExtras,
    format: "block-editor/v0.3",
    blocks: document.content.content.map(convert),
  }
}

import { type MarkSpec, type NodeSpec, Schema } from "prosemirror-model"
import type { BlockRegistration, ProseMirrorProfile } from "./types.js"

export const blockAttrs = {
  id: { default: "" },
  locked: { default: false },
  snapshotAttrs: { default: {} },
  blockExtras: { default: {} },
  snapshotType: { default: "" },
} as const

const markAttrs = { snapshot: { default: null } }
const marks: Readonly<Record<string, MarkSpec>> = {
  strong: { attrs: markAttrs, toDOM: () => ["strong", 0] },
  em: { attrs: markAttrs, toDOM: () => ["em", 0] },
  code: { attrs: markAttrs, toDOM: () => ["code", 0] },
  link: {
    attrs: { ...markAttrs, href: { default: "" } },
    inclusive: false,
    toDOM: (mark) => ["a", { href: mark.attrs["href"], rel: "noreferrer", target: "_blank" }, 0],
  },
}

const opaque: NodeSpec = {
  group: "block",
  atom: true,
  selectable: true,
  attrs: { ...blockAttrs, raw: { default: "{}" }, originalType: { default: "unknown" } },
  toDOM: (node) => [
    "section",
    { "data-block-id": node.attrs["id"], "data-opaque": "true" },
    ["strong", "읽기 전용 확장 블록"],
    ["span", ` ${String(node.attrs["originalType"])}`],
  ],
}

export const createProseMirrorProfile = (
  blocks: readonly BlockRegistration[],
  defaultTextType: string,
): ProseMirrorProfile => {
  const registrations = new Map<string, BlockRegistration>()
  const registrationsByNode = new Map<string, BlockRegistration>()
  const nodes: Record<string, NodeSpec> = {
    doc: { content: "block+", attrs: { documentExtras: { default: {} } } },
    text: { group: "inline" },
    opaque,
  }
  for (const block of blocks) {
    if (registrations.has(block.type)) throw new TypeError(`Duplicate block type: ${block.type}`)
    if (registrationsByNode.has(block.nodeName))
      throw new TypeError(`Duplicate ProseMirror node: ${block.nodeName}`)
    registrations.set(block.type, block)
    registrationsByNode.set(block.nodeName, block)
    nodes[block.nodeName] = block.nodeSpec
  }
  if (registrations.get(defaultTextType)?.text !== true)
    throw new TypeError(`Default text block is not registered: ${defaultTextType}`)
  return {
    schema: new Schema({ nodes, marks }),
    registrations,
    registrationsByNode,
    defaultTextType,
  }
}

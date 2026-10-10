import type { Node as ProseMirrorNode } from "prosemirror-model"
import { Fragment, Slice } from "prosemirror-model"
import { Plugin } from "prosemirror-state"
import { blockReferenceAttrs, remapBlock } from "../core/clipboard"
import { decodeDocument } from "../core/codec"

const remapNodeAttrs = (
  node: ProseMirrorNode,
  ids: ReadonlyMap<string, string>,
): Readonly<Record<string, unknown>> => {
  const oldId = node.attrs["id"]
  const attrs: Record<string, unknown> = {
    ...node.attrs,
    id: typeof oldId === "string" ? (ids.get(oldId) ?? oldId) : crypto.randomUUID(),
  }
  const referenceAttrs = blockReferenceAttrs(node.type.name)
  const stored = node.attrs["snapshotAttrs"]
  if (typeof stored === "object" && stored !== null) {
    const snapshotAttrs: Record<string, unknown> = { ...stored }
    for (const name of referenceAttrs) {
      const reference = snapshotAttrs[name]
      if (typeof reference === "string" && ids.has(reference))
        snapshotAttrs[name] = ids.get(reference)
    }
    attrs["snapshotAttrs"] = snapshotAttrs
  }
  for (const name of referenceAttrs) {
    const reference = node.attrs[name]
    if (typeof reference === "string" && ids.has(reference)) attrs[name] = ids.get(reference)
  }
  const raw = node.attrs["raw"]
  if (node.type.name === "opaque" && typeof raw === "string") {
    try {
      const document = decodeDocument({ format: "block-editor/v0.3", blocks: [JSON.parse(raw)] })
      const block = document.blocks[0]
      if (block !== undefined) attrs["raw"] = JSON.stringify(remapBlock(block, ids))
    } catch (error) {
      if (!(error instanceof Error)) throw error
    }
  }
  return attrs
}

export const freshenPastedSlice = (
  slice: Slice,
  allocateId: (oldId: string) => string = () => crypto.randomUUID(),
): Slice => {
  const ids = new Map<string, string>()
  slice.content.forEach((node) => {
    const id = node.attrs["id"]
    if (typeof id === "string" && id.length > 0) ids.set(id, allocateId(id))
  })
  if (ids.size === 0) return slice
  const nodes: ProseMirrorNode[] = []
  slice.content.forEach((node) => {
    nodes.push(node.type.create(remapNodeAttrs(node, ids), node.content, node.marks))
  })
  return new Slice(Fragment.fromArray(nodes), slice.openStart, slice.openEnd)
}

export const clipboardPlugin = new Plugin({
  props: {
    transformPasted: (slice) => freshenPastedSlice(slice),
  },
})

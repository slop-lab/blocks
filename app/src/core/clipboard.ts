import type { BlockSnapshot } from "./types"

export const declaredBlockReferences = { caption: ["refBlockId"] } as const

export const blockReferenceAttrs = (blockType: string): readonly string[] =>
  blockType === "caption" ? declaredBlockReferences.caption : []

const remapAttrs = (
  blockType: string,
  attrs: Readonly<Record<string, unknown>>,
  ids: ReadonlyMap<string, string>,
): Readonly<Record<string, unknown>> => {
  const result: Record<string, unknown> = { ...attrs }
  for (const name of blockReferenceAttrs(blockType)) {
    const value = attrs[name]
    if (typeof value === "string" && ids.has(value)) result[name] = ids.get(value)
  }
  return result
}

export const copyBlocks = (
  blocks: readonly BlockSnapshot[],
  allocateId: (oldId: string) => string,
): readonly BlockSnapshot[] => {
  const ids = new Map(blocks.map((block) => [block.id, allocateId(block.id)]))
  return blocks.map((block) => ({
    ...structuredClone(block),
    id: ids.get(block.id) ?? allocateId(block.id),
    attrs: remapAttrs(block.type, block.attrs, ids),
  }))
}

export const remapBlock = (
  block: BlockSnapshot,
  ids: ReadonlyMap<string, string>,
): BlockSnapshot => ({
  ...structuredClone(block),
  id: ids.get(block.id) ?? block.id,
  attrs: remapAttrs(block.type, block.attrs, ids),
})

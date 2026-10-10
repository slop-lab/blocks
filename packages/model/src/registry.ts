import type { BlockDefinition, BlockRenderer } from "./types.js"

export type BlockRegistry = {
  readonly definitions: ReadonlyMap<string, BlockDefinition>
  readonly defaultTextType: string
  readonly rendererFor: (type: string) => BlockRenderer | undefined
}

export const createBlockRegistry = (
  definitions: readonly BlockDefinition[],
  defaultTextType: string,
): BlockRegistry => {
  const entries = new Map<string, BlockDefinition>()
  for (const definition of definitions) {
    if (entries.has(definition.type)) throw new TypeError(`Duplicate block type: ${definition.type}`)
    entries.set(definition.type, definition)
  }
  const defaultText = entries.get(defaultTextType)
  if (defaultText?.text !== true)
    throw new TypeError(`Default text block is not registered: ${defaultTextType}`)
  return {
    definitions: entries,
    defaultTextType,
    rendererFor: (type) => entries.get(type)?.render,
  }
}

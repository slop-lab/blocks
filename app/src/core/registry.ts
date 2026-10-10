import type { BlockDocument } from "./types"

export type ExtensionDeclaration = {
  readonly name: string
  readonly provides: readonly string[]
  readonly requires: readonly string[]
  readonly conflicts: readonly string[]
  readonly normalize?: (document: BlockDocument) => BlockDocument
}

export type NormalizerLimits = {
  readonly maxBlocks: number
  readonly maxPasses?: number
}

const assertInitialRegistry = (initial: readonly ExtensionDeclaration[]): void => {
  const names = new Set(initial.map((extension) => extension.name))
  if (names.size !== initial.length) throw new TypeError("Extension name conflict")
  const capabilities = new Set(initial.flatMap((extension) => extension.provides))
  if (
    capabilities.size !== initial.reduce((count, extension) => count + extension.provides.length, 0)
  )
    throw new TypeError("Extension capability conflict")
  for (const extension of initial) {
    const missing = extension.requires.find((required) => !capabilities.has(required))
    if (missing !== undefined) throw new TypeError(`Missing dependency: ${missing}`)
    const conflict = extension.conflicts.find((name) => names.has(name))
    if (conflict !== undefined) throw new TypeError(`Extension conflict: ${conflict}`)
  }
}

export const createRegistry = (initial: readonly ExtensionDeclaration[]) => {
  assertInitialRegistry(initial)
  const extensions = new Map(initial.map((extension) => [extension.name, extension]))
  const capabilities = new Set(initial.flatMap((extension) => extension.provides))
  return {
    check(extension: ExtensionDeclaration) {
      if (extensions.has(extension.name))
        return { kind: "conflict" as const, extension: extension.name }
      const missing = extension.requires.find((required) => !capabilities.has(required))
      if (missing !== undefined) return { kind: "missing_dependency" as const, capability: missing }
      const conflict = extension.conflicts.find((name) => extensions.has(name))
      if (conflict !== undefined) return { kind: "conflict" as const, extension: conflict }
      const reverseConflict = initial.find((current) => current.conflicts.includes(extension.name))
      if (reverseConflict !== undefined)
        return { kind: "conflict" as const, extension: reverseConflict.name }
      const duplicate = extension.provides.find((provided) => capabilities.has(provided))
      if (duplicate !== undefined) return { kind: "conflict" as const, extension: duplicate }
      return { kind: "available" as const }
    },
    normalize(document: BlockDocument, limits: NormalizerLimits) {
      const maxPasses = limits.maxPasses ?? 100
      let current = document
      if (current.blocks.length > limits.maxBlocks)
        throw new RangeError("Normalizer block bound exceeded")
      let revision = JSON.stringify(current)
      const seen = new Set([revision])
      for (let pass = 0; pass < maxPasses; pass += 1) {
        let changed = false
        for (const extension of initial) {
          const next = extension.normalize?.(current) ?? current
          if (next.blocks.length > limits.maxBlocks)
            throw new RangeError("Normalizer block bound exceeded")
          const nextRevision = JSON.stringify(next)
          if (nextRevision !== revision) {
            changed = true
            if (seen.has(nextRevision)) throw new RangeError("Normalizer oscillation detected")
            seen.add(nextRevision)
          }
          current = next
          revision = nextRevision
        }
        if (!changed) return current
      }
      throw new RangeError("Normalizer fixed-point bound exceeded")
    },
  }
}

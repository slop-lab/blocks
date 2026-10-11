import type { SyncedSource } from "./schemas.js"

export const headingLevelAtDepth = (authoredLevel: number, embeddingDepth: number): number =>
  Math.min(6, Math.max(1, authoredLevel + Math.max(0, embeddingDepth)))

export type SyncedOccurrence = { readonly id: string; readonly sourceId: string }

export const copySyncedOccurrence = (
  occurrence: SyncedOccurrence,
  createId: () => string,
): SyncedOccurrence => ({ id: createId(), sourceId: occurrence.sourceId })

export const snapshotSyncedSource = (
  source: SyncedSource,
  createId: () => string,
): SyncedSource["blocks"] => source.blocks.map((block) => ({ ...block, id: createId() }))

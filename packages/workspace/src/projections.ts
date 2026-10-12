import type { SectionBlock, SyncedSource, WorkspaceBlock } from "./schemas.js"
import { isOpaqueWorkspaceBlock } from "./schemas.js"

export const headingLevelAtDepth = (authoredLevel: number, embeddingDepth: number): number =>
  Math.min(6, Math.max(1, authoredLevel + Math.max(0, embeddingDepth)))

export type SyncedOccurrence = { readonly id: string; readonly sourceId: string }

export const copySyncedOccurrence = (
  occurrence: SyncedOccurrence,
  createId: () => string,
): SyncedOccurrence => ({ id: createId(), sourceId: occurrence.sourceId })

export type SyncedSectionConversion = {
  readonly source: SyncedSource
  readonly occurrence: SectionBlock
}

export const convertSectionToSyncedSource = (
  section: SectionBlock,
  createId: () => string,
): SyncedSectionConversion => {
  const sourceId = createId()
  const sourceRootId = createId()
  const occurrenceId = createId()
  const { ref, occurrenceId: previousOccurrenceId, ...local } = section
  void ref
  void previousOccurrenceId
  return {
    source: {
      id: sourceId,
      version: 1,
      section: { ...local, id: sourceRootId },
    },
    occurrence: {
      id: section.id,
      type: "section",
      occurrenceId,
      ref: { sourceId },
      children: [],
    },
  }
}

export const snapshotSyncedSource = (
  source: SyncedSource,
  createId: () => string,
): readonly WorkspaceBlock[] => {
  const clone = (block: WorkspaceBlock): WorkspaceBlock => {
    if (isOpaqueWorkspaceBlock(block)) return block
    switch (block.type) {
      case "paragraph":
      case "code":
      case "page_ref":
      case "database_embed":
        return { ...block, id: createId() }
      case "section": {
        const { ref, occurrenceId, ...local } = block
        void ref
        void occurrenceId
        return { ...local, id: createId(), children: block.children.map(clone) }
      }
      case "callout":
      case "quote":
        return { ...block, id: createId(), children: block.children.map(clone) }
      default:
        return block satisfies never
    }
  }
  return source.section.type === "section" && !isOpaqueWorkspaceBlock(source.section)
    ? source.section.children.map(clone)
    : []
}

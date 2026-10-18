import {
  isOpaqueWorkspaceBlock,
  type PageDocument,
  type SyncedSource,
  type WorkspaceBlock,
} from "@slop-lab/blocks-workspace"
import { z } from "zod"

const focusTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local"), blockId: z.string().min(1) }),
  z.object({
    kind: z.literal("shared"),
    occurrenceId: z.string().min(1),
    blockId: z.string().min(1),
  }),
])

export type WorkspaceFocusTarget = z.infer<typeof focusTargetSchema>

export type WorkspaceFocusCrumb = {
  readonly label: string
  readonly target: WorkspaceFocusTarget | null
}

export type WorkspaceFocus = {
  readonly target: WorkspaceFocusTarget
  readonly breadcrumbs: readonly WorkspaceFocusCrumb[]
  readonly ancestorBlockIds: readonly string[]
  readonly sourceId?: string
}

export const focusedLocalBlocks = (
  document: PageDocument,
  focus: WorkspaceFocus | null,
): readonly WorkspaceBlock[] => {
  if (focus === null) return document.blocks
  if (focus.target.kind === "shared") return []
  const path = findBlockPath(document.blocks, focus.target.blockId)
  const block = path?.at(-1)
  return block === undefined ? document.blocks : [block]
}

type ResolveWorkspaceFocusInput = {
  readonly pageTitle: string
  readonly document: PageDocument
  readonly sources: readonly SyncedSource[]
  readonly target: WorkspaceFocusTarget
  readonly previousAncestors?: readonly string[]
}

const blockLabel = (block: WorkspaceBlock): string => {
  if (isOpaqueWorkspaceBlock(block)) return block.type
  switch (block.type) {
    case "paragraph":
    case "code":
      return block.text.trim().slice(0, 48) || "Untitled block"
    case "section":
      return block.heading?.trim() || "Untitled section"
    case "callout":
      return "Callout"
    case "quote":
      return "Quote"
    case "page_ref":
      return "Linked page"
    case "database_embed":
      return "Database"
    default:
      return block satisfies never
  }
}

const findBlockPath = (
  blocks: readonly WorkspaceBlock[],
  blockId: string,
  parents: readonly WorkspaceBlock[] = [],
): readonly WorkspaceBlock[] | null => {
  for (const block of blocks) {
    const path = [...parents, block]
    if (block.id === blockId) return path
    if (!isOpaqueWorkspaceBlock(block) && "children" in block) {
      const nested = findBlockPath(block.children, blockId, path)
      if (nested !== null) return nested
    }
  }
  return null
}

const findOccurrencePath = (
  blocks: readonly WorkspaceBlock[],
  occurrenceId: string,
  parents: readonly WorkspaceBlock[] = [],
): readonly WorkspaceBlock[] | null => {
  for (const block of blocks) {
    const path = [...parents, block]
    if (
      !isOpaqueWorkspaceBlock(block) &&
      block.type === "section" &&
      block.occurrenceId === occurrenceId
    )
      return path
    if (!isOpaqueWorkspaceBlock(block) && "children" in block) {
      const nested = findOccurrencePath(block.children, occurrenceId, path)
      if (nested !== null) return nested
    }
  }
  return null
}

const localFocus = (
  pageTitle: string,
  blocks: readonly WorkspaceBlock[],
  blockId: string,
): WorkspaceFocus | null => {
  const path = findBlockPath(blocks, blockId)
  if (path === null) return null
  return {
    target: { kind: "local", blockId },
    breadcrumbs: [
      { label: pageTitle, target: null },
      ...path.map((block) => ({
        label: blockLabel(block),
        target: { kind: "local", blockId: block.id } satisfies WorkspaceFocusTarget,
      })),
    ],
    ancestorBlockIds: path.map((block) => block.id),
  }
}

export const resolveWorkspaceFocus = (input: ResolveWorkspaceFocusInput): WorkspaceFocus | null => {
  if (input.target.kind === "local") {
    const direct = localFocus(input.pageTitle, input.document.blocks, input.target.blockId)
    if (direct !== null) return direct
    for (const ancestorId of [...(input.previousAncestors ?? [])].reverse()) {
      const fallback = localFocus(input.pageTitle, input.document.blocks, ancestorId)
      if (fallback !== null) return fallback
    }
    return null
  }

  const target = input.target
  const occurrencePath = findOccurrencePath(input.document.blocks, target.occurrenceId)
  const occurrence = occurrencePath?.at(-1)
  const sourceId =
    occurrence !== undefined &&
    !isOpaqueWorkspaceBlock(occurrence) &&
    occurrence.type === "section" &&
    occurrence.occurrenceId === target.occurrenceId
      ? occurrence.ref?.sourceId
      : undefined
  if (sourceId === undefined) return null
  const source = input.sources.find((candidate) => candidate.id === sourceId)
  if (source === undefined || source.section.type !== "section") return null
  let path = findBlockPath([source.section], target.blockId)
  if (path === null)
    for (const ancestorId of [...(input.previousAncestors ?? [])].reverse()) {
      path = findBlockPath([source.section], ancestorId)
      if (path !== null) break
    }
  if (path === null) return null
  const focusedBlock = path.at(-1)
  if (focusedBlock === undefined) return null
  const resolvedTarget = {
    kind: "shared",
    occurrenceId: target.occurrenceId,
    blockId: focusedBlock.id,
  } satisfies WorkspaceFocusTarget
  const embeddingAncestors = occurrencePath?.slice(0, -1) ?? []
  return {
    target: resolvedTarget,
    sourceId,
    breadcrumbs: [
      { label: input.pageTitle, target: null },
      ...embeddingAncestors.map((block) => ({
        label: blockLabel(block),
        target: { kind: "local", blockId: block.id } satisfies WorkspaceFocusTarget,
      })),
      ...path.map((block) => ({
        label: blockLabel(block),
        target: {
          kind: "shared",
          occurrenceId: target.occurrenceId,
          blockId: block.id,
        } satisfies WorkspaceFocusTarget,
      })),
    ],
    ancestorBlockIds: [...embeddingAncestors, ...path].map((block) => block.id),
  }
}

export const focusHash = (target: WorkspaceFocusTarget): string =>
  `#focus=${encodeURIComponent(JSON.stringify(target))}`

export const sameFocusTarget = (
  left: WorkspaceFocusTarget | null,
  right: WorkspaceFocusTarget | null,
): boolean =>
  left?.kind === right?.kind &&
  left?.blockId === right?.blockId &&
  (left?.kind !== "shared" || right?.kind !== "shared" || left.occurrenceId === right.occurrenceId)

export const parseFocusHash = (hash: string): WorkspaceFocusTarget | null => {
  if (!hash.startsWith("#focus=")) return null
  try {
    const parsed = focusTargetSchema.safeParse(JSON.parse(decodeURIComponent(hash.slice(7))))
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error instanceof URIError || error instanceof SyntaxError) return null
    throw error
  }
}

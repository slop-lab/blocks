import type { BlockDocument, BlockSnapshot, InlineSnapshot } from "@block-editor/model"
import {
  blockSchema,
  isOpaqueWorkspaceBlock,
  type PageDocument,
  type SyncedSource,
  type WorkspaceBlock,
} from "@block-editor/workspace"

const textContent = (text: string) =>
  text.length === 0 ? [] : [{ kind: "text" as const, text, marks: [] }]

const persistedContent = (
  content: readonly InlineSnapshot[] | undefined,
  fallback: string,
): readonly InlineSnapshot[] => content ?? textContent(fallback)

const toSnapshot = (block: WorkspaceBlock, sources: readonly SyncedSource[]): BlockSnapshot => {
  if (isOpaqueWorkspaceBlock(block))
    return {
      id: block.id,
      type: "workspace.opaque",
      originalType: block.type,
      attrs: {},
      content: [],
      locked: true,
      workspaceRaw: block,
    }
  switch (block.type) {
    case "paragraph":
      return {
        id: block.id,
        type: block.type,
        attrs: {},
        content: persistedContent(block.content, block.text),
      }
    case "code":
      return { id: block.id, type: block.type, attrs: {}, content: textContent(block.text) }
    case "section":
      void sources
      return {
        id: block.id,
        type: "section",
        attrs: { sourceId: block.ref?.sourceId ?? "", occurrenceId: block.occurrenceId ?? "" },
        content: persistedContent(block.headingContent, block.heading ?? ""),
        children: block.children.map((child) => toSnapshot(child, sources)),
      }
    case "callout":
    case "quote":
      return {
        id: block.id,
        type: block.type,
        attrs: {},
        content: [],
        children: block.children.map((child) => toSnapshot(child, sources)),
      }
    case "page_ref":
      return {
        id: block.id,
        type: "workspace.page_ref",
        attrs: { pageId: block.pageId },
        content: [],
      }
    case "database_embed":
      return {
        id: block.id,
        type: "workspace.database_embed",
        attrs: { databaseId: block.databaseId, layout: block.layout },
        content: [],
      }
    default:
      return block satisfies never
  }
}

export const pageDocumentToSnapshot = (
  document: PageDocument,
  sources: readonly SyncedSource[] = [],
): BlockDocument => {
  const reserved = new Set<string>()
  const reserve = (block: BlockSnapshot): void => {
    reserved.add(block.id)
    block.children?.forEach(reserve)
  }
  const snapshots = document.blocks.map((block) => toSnapshot(block, sources))
  snapshots.forEach(reserve)
  const used = new Set<string>()
  const nextSuffix = new Map<string, number>()
  const unique = (block: BlockSnapshot): BlockSnapshot => {
    let id = block.id
    if (used.has(id)) {
      let suffix = nextSuffix.get(block.id) ?? 1
      id = `${block.id.slice(0, 140)}__duplicate_${suffix}`
      while (reserved.has(id) || used.has(id)) {
        suffix += 1
        id = `${block.id.slice(0, 140)}__duplicate_${suffix}`
      }
      nextSuffix.set(block.id, suffix + 1)
    }
    used.add(id)
    return {
      ...block,
      id,
      ...(block.children === undefined ? {} : { children: block.children.map(unique) }),
    }
  }
  return { format: "block-editor/v0.3", blocks: snapshots.map(unique) }
}

const snapshotText = (block: BlockSnapshot): string =>
  block.content.flatMap((inline) => (inline.kind === "text" ? [inline.text] : [])).join("")

const richContent = (block: BlockSnapshot): readonly InlineSnapshot[] | undefined => {
  const text = block.content.filter((inline) => inline.kind === "text")
  return text.length > 1 || text.some((inline) => inline.marks.length > 0) ? text : undefined
}

const fromSnapshot = (block: BlockSnapshot): WorkspaceBlock => {
  const workspaceRaw = block["workspaceRaw"]
  if (workspaceRaw !== undefined) return blockSchema.parse(workspaceRaw)
  const attrs = block.attrs
  switch (block.type) {
    case "paragraph": {
      const content = richContent(block)
      return blockSchema.parse({
        id: block.id,
        type: block.type,
        text: snapshotText(block),
        ...(content === undefined ? {} : { content }),
      })
    }
    case "code":
      return blockSchema.parse({ id: block.id, type: block.type, text: snapshotText(block) })
    case "section": {
      const heading = snapshotText(block)
      const sourceId = attrs["sourceId"]
      const occurrenceId = attrs["occurrenceId"]
      return blockSchema.parse({
        id: block.id,
        type: "section",
        ...(heading.length === 0 ? {} : { heading }),
        ...(richContent(block) === undefined ? {} : { headingContent: richContent(block) }),
        ...(typeof sourceId === "string" && sourceId.length > 0 ? { ref: { sourceId } } : {}),
        ...(typeof occurrenceId === "string" && occurrenceId.length > 0 ? { occurrenceId } : {}),
        children:
          typeof sourceId === "string" && sourceId.length > 0
            ? []
            : (block.children ?? []).map(fromSnapshot),
      })
    }
    case "callout":
    case "quote":
      return blockSchema.parse({
        id: block.id,
        type: block.type,
        children: (block.children ?? []).map(fromSnapshot),
      })
    case "workspace.page_ref":
      return blockSchema.parse({ id: block.id, type: "page_ref", pageId: attrs["pageId"] })
    case "workspace.database_embed":
      return blockSchema.parse({
        id: block.id,
        type: "database_embed",
        databaseId: attrs["databaseId"],
        layout: attrs["layout"],
      })
    default:
      throw new TypeError(`Unsupported workspace block ${block.type}`)
  }
}

export const snapshotToPageDocument = (
  snapshot: BlockDocument,
  original: PageDocument,
): PageDocument => ({
  ...original,
  version: original.version + 1,
  blocks: snapshot.blocks.map(fromSnapshot),
})

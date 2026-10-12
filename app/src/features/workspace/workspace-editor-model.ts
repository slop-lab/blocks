import type { BlockDocument, BlockSnapshot, InlineSnapshot } from "@block-editor/model"
import {
  type BlockRegistration,
  blockAttrs,
  createProseMirrorProfile,
  type ProseMirrorProfile,
} from "@block-editor/prosemirror"
import { codeBlock } from "@block-editor/prosemirror/code"
import {
  calloutBlock,
  containerQuoteBlock,
  sectionBlock,
  sectionTitle,
} from "@block-editor/prosemirror/containers"
import { paragraphBlock } from "@block-editor/prosemirror/paragraph"
import {
  blockSchema,
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

const atomic = (
  type: string,
  nodeName: string,
  attrs: Readonly<Record<string, unknown>>,
): BlockRegistration => ({
  type,
  nodeName,
  text: false,
  nodeSpec: {
    group: "block",
    atom: true,
    selectable: true,
    attrs: { ...blockAttrs, ...attrs },
    toDOM: (node) => [
      "section",
      { "data-block-id": node.attrs["id"], "data-workspace-atom": nodeName },
      nodeName,
    ],
  },
})

const pageReference = atomic("workspace.page_ref", "workspace_page_ref", {
  pageId: { default: "" },
})
const databaseEmbed = atomic("workspace.database_embed", "workspace_database_embed", {
  databaseId: { default: "" },
  layout: { default: "table" },
})
const workspaceSection: BlockRegistration = {
  ...sectionBlock,
  referenceAttrs: ["sourceId"],
  nodeSpec: {
    ...sectionBlock.nodeSpec,
    attrs: {
      ...blockAttrs,
      sourceId: { default: "" },
      occurrenceId: { default: "" },
    },
  },
}

export const createWorkspaceProfile = (embeddingDepth: number): ProseMirrorProfile => {
  void embeddingDepth
  return createProseMirrorProfile(
    [
      paragraphBlock,
      codeBlock,
      sectionTitle,
      workspaceSection,
      calloutBlock,
      containerQuoteBlock,
      pageReference,
      databaseEmbed,
    ],
    "paragraph",
  )
}

const toSnapshot = (block: WorkspaceBlock, sources: readonly SyncedSource[]): BlockSnapshot => {
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
    case "section": {
      void sources
      return {
        id: block.id,
        type: "section",
        attrs: {
          sourceId: block.ref?.sourceId ?? "",
          occurrenceId: block.occurrenceId ?? "",
        },
        content: persistedContent(block.headingContent, block.heading ?? ""),
        children: block.children.map((child) => toSnapshot(child, sources)),
      }
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
): BlockDocument => ({
  format: "block-editor/v0.3",
  blocks: document.blocks.map((block) => toSnapshot(block, sources)),
})

const snapshotText = (block: BlockSnapshot): string =>
  block.content.flatMap((inline) => (inline.kind === "text" ? [inline.text] : [])).join("")

const richContent = (block: BlockSnapshot): readonly InlineSnapshot[] | undefined => {
  const text = block.content.filter((inline) => inline.kind === "text")
  return text.length > 1 || text.some((inline) => inline.marks.length > 0) ? text : undefined
}

const fromSnapshot = (block: BlockSnapshot): WorkspaceBlock => {
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

export const embeddedDatabaseIds = (blocks: readonly WorkspaceBlock[]): readonly string[] =>
  blocks.flatMap((block): readonly string[] => {
    switch (block.type) {
      case "database_embed":
        return [block.databaseId]
      case "section":
      case "callout":
      case "quote":
        return embeddedDatabaseIds(block.children)
      case "paragraph":
      case "code":
      case "page_ref":
        return []
      default:
        return block satisfies never
    }
  })

export type PageReferenceTarget = {
  readonly blockId: string
  readonly pageId: string
}

export const pageReferenceTargets = (
  blocks: readonly WorkspaceBlock[],
): readonly PageReferenceTarget[] =>
  blocks.flatMap((block): readonly PageReferenceTarget[] => {
    switch (block.type) {
      case "page_ref":
        return [{ blockId: block.id, pageId: block.pageId }]
      case "section":
      case "callout":
      case "quote":
        return pageReferenceTargets(block.children)
      case "paragraph":
      case "code":
      case "database_embed":
        return []
      default:
        return block satisfies never
    }
  })

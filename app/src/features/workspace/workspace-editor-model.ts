import type { BlockDocument, BlockSnapshot } from "@block-editor/model"
import {
  type BlockRegistration,
  blockAttrs,
  createProseMirrorProfile,
  type ProseMirrorProfile,
} from "@block-editor/prosemirror"
import { codeBlock } from "@block-editor/prosemirror/code"
import { headingBlock } from "@block-editor/prosemirror/heading"
import { paragraphBlock } from "@block-editor/prosemirror/paragraph"
import { quoteBlock } from "@block-editor/prosemirror/quote"
import { blockSchema, type PageDocument } from "@block-editor/workspace"

const textContent = (text: string) =>
  text.length === 0 ? [] : [{ kind: "text" as const, text, marks: [] }]

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
const syncedReference = atomic("workspace.synced_ref", "workspace_synced_ref", {
  occurrenceId: { default: "" },
  sourceId: { default: "" },
})

export const createWorkspaceProfile = (depth: number): ProseMirrorProfile => {
  const contextualHeading: BlockRegistration = {
    ...headingBlock,
    nodeSpec: {
      ...headingBlock.nodeSpec,
      toDOM: (node) => {
        const authored = typeof node.attrs["level"] === "number" ? node.attrs["level"] : 2
        const level = Math.min(6, Math.max(1, authored + Math.max(0, depth)))
        return [
          `h${level}`,
          {
            "data-block-id": node.attrs["id"],
            "data-authored-level": authored,
          },
          0,
        ]
      },
    },
  }
  return createProseMirrorProfile(
    [
      paragraphBlock,
      contextualHeading,
      quoteBlock,
      codeBlock,
      pageReference,
      databaseEmbed,
      syncedReference,
    ],
    "paragraph",
  )
}

export const pageDocumentToSnapshot = (document: PageDocument): BlockDocument => ({
  format: "block-editor/v0.3",
  blocks: document.blocks.map((block): BlockSnapshot => {
    switch (block.type) {
      case "paragraph":
      case "quote":
      case "code":
        return { id: block.id, type: block.type, attrs: {}, content: textContent(block.text) }
      case "heading":
        return {
          id: block.id,
          type: "heading",
          attrs: { level: block.level },
          content: textContent(block.text),
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
      case "synced_ref":
        return {
          id: block.id,
          type: "workspace.synced_ref",
          attrs: { occurrenceId: block.occurrenceId, sourceId: block.sourceId },
          content: [],
        }
      default:
        return block satisfies never
    }
  }),
})

const snapshotText = (block: BlockSnapshot): string =>
  block.content.flatMap((inline) => (inline.kind === "text" ? [inline.text] : [])).join("")

export const snapshotToPageDocument = (
  snapshot: BlockDocument,
  original: PageDocument,
): PageDocument => ({
  ...original,
  version: original.version + 1,
  blocks: snapshot.blocks.map((block) => {
    const attrs = block.attrs
    switch (block.type) {
      case "paragraph":
      case "quote":
      case "code":
        return blockSchema.parse({ id: block.id, type: block.type, text: snapshotText(block) })
      case "heading":
        return blockSchema.parse({
          id: block.id,
          type: "heading",
          level: attrs["level"],
          text: snapshotText(block),
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
      case "workspace.synced_ref":
        return blockSchema.parse({
          id: block.id,
          type: "synced_ref",
          occurrenceId: attrs["occurrenceId"],
          sourceId: attrs["sourceId"],
        })
      default:
        throw new TypeError(`Unsupported workspace block ${block.type}`)
    }
  }),
})

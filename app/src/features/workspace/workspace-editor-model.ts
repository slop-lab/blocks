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
import { isOpaqueWorkspaceBlock, type WorkspaceBlock } from "@block-editor/workspace"

export { pageDocumentToSnapshot, snapshotToPageDocument } from "./workspace-editor-codec"

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

export const embeddedDatabaseIds = (blocks: readonly WorkspaceBlock[]): readonly string[] =>
  blocks.flatMap((block): readonly string[] => {
    if (isOpaqueWorkspaceBlock(block)) return []
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
    if (isOpaqueWorkspaceBlock(block)) return []
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

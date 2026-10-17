import type { ProseMirrorProfile } from "@slop-lab/blocks-prosemirror"
import type { Database, SyncedSource, Workspace } from "@slop-lab/blocks-workspace"
import { Fragment, type Node as ProseMirrorNode } from "prosemirror-model"
import type { EntityRecord } from "./workspace-api"

export type WorkspaceNodeViewData = {
  readonly workspace: Workspace
  readonly databases: readonly Database[]
  readonly sources: readonly EntityRecord<SyncedSource>[]
  readonly profile: ProseMirrorProfile
  readonly onOpenPage: (id: string, blockId?: string) => void
  readonly onSourceEdit: (request: SourceEditRequest) => void
  readonly onSourceCreate: (source: SyncedSource) => Promise<EntityRecord<SyncedSource> | null>
  readonly onSourceCompositionChange: (sourceId: string, composing: boolean) => void
  readonly onSourceConflictResolve: (
    sourceId: string,
    resolution: "accept-remote" | "keep-local",
  ) => void
  readonly embeddingDepth: number
}

export type SourceEditRequest = {
  readonly sourceId: string
  readonly baselineRevision: number
  readonly generation: number
  readonly causeId: string
  readonly content: SyncedSource
}

export const nodeViewButton = (
  ownerDocument: Document,
  label: string,
  action: () => void,
): HTMLButtonElement => {
  const element = ownerDocument.createElement("button")
  element.type = "button"
  element.textContent = label
  element.addEventListener("click", () => {
    element.focus()
    action()
  })
  return element
}

export const freshClone = (node: ProseMirrorNode): ProseMirrorNode => {
  if (node.isText) return node
  const children: ProseMirrorNode[] = []
  node.content.forEach((child) => {
    children.push(freshClone(child))
  })
  return node.type.create(
    { ...node.attrs, id: crypto.randomUUID(), occurrenceId: "", sourceId: "" },
    children.length === 0 ? undefined : Fragment.fromArray(children),
    node.marks,
  )
}

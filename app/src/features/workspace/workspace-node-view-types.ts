import type { ProseMirrorProfile } from "@block-editor/prosemirror"
import type { Database, SyncedSource, Workspace } from "@block-editor/workspace"
import { Fragment, type Node as ProseMirrorNode } from "prosemirror-model"
import type { EditorView } from "prosemirror-view"

export type WorkspaceNodeViewData = {
  readonly workspace: Workspace
  readonly databases: readonly Database[]
  readonly sources: readonly SyncedSource[]
  readonly profile: ProseMirrorProfile
  readonly onOpenPage: (id: string, blockId?: string) => void
  readonly onSourceEdit: (source: SyncedSource) => void
  readonly onSourceCreate: (source: SyncedSource) => Promise<SyncedSource | null>
  readonly onSourceCompositionChange: (sourceId: string, composing: boolean) => void
  readonly embeddingDepth: number
}

export type NestedEditor = {
  readonly view: EditorView
  readonly refresh: () => void
  readonly destroy: () => void
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

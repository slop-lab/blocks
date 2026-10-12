import type { Node as ProseMirrorNode } from "prosemirror-model"
import { type EditorState, Plugin, PluginKey } from "prosemirror-state"
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view"
import {
  type BlockSelectionScope,
  type BlockSelectionState,
  initialBlockSelectionState,
  reconcileBlockSelection,
} from "./selection.js"

export type ProseMirrorSelectionMode = "none" | "text" | "blocks"

export type ProseMirrorSelectionState = BlockSelectionState & {
  readonly mode: ProseMirrorSelectionMode
}

export const initialProseMirrorSelectionState: ProseMirrorSelectionState = {
  mode: "none",
  ...initialBlockSelectionState,
}

const updates = new WeakMap<EditorView, () => void>()
const selectionKey = new PluginKey<ProseMirrorSelectionState>("block-editor-selection")

export const selectionScopeForDocument = (
  document: ProseMirrorNode,
  visibleIds?: readonly string[],
): BlockSelectionScope => {
  const documentIds: string[] = []
  const parentById = new Map<string, string | null>()
  const visit = (parent: ProseMirrorNode, parentId: string | null): void => {
    parent.forEach((node) => {
      const rawId = node.attrs["id"]
      const id = typeof rawId === "string" && rawId.length > 0 ? rawId : null
      if (id !== null) {
        documentIds.push(id)
        parentById.set(id, parentId)
      }
      visit(node, id ?? parentId)
    })
  }
  visit(document, null)
  if (visibleIds === undefined) return { visibleIds: documentIds, parentById }
  const visible = new Set(visibleIds)
  return { visibleIds: documentIds.filter((id) => visible.has(id)), parentById }
}

const normalize = (
  state: ProseMirrorSelectionState,
  document: ProseMirrorNode,
): ProseMirrorSelectionState => {
  const reconciled = reconcileBlockSelection(state, selectionScopeForDocument(document))
  if (state.mode !== "blocks") return { ...reconciled, mode: state.mode, selectedIds: [] }
  return {
    ...reconciled,
    mode: reconciled.selectedIds.length === 0 ? "none" : "blocks",
  }
}

const parseSelectionMeta = (meta: unknown): ProseMirrorSelectionState | null => {
  if (typeof meta !== "object" || meta === null || !("mode" in meta) || !("selectedIds" in meta))
    return null
  const mode = meta.mode
  const selectedIds = meta.selectedIds
  const anchorId = "anchorId" in meta ? meta.anchorId : null
  const focusId = "focusId" in meta ? meta.focusId : null
  return (mode === "none" || mode === "text" || mode === "blocks") &&
    Array.isArray(selectedIds) &&
    selectedIds.every((id): id is string => typeof id === "string") &&
    (typeof anchorId === "string" || anchorId === null) &&
    (typeof focusId === "string" || focusId === null)
    ? { mode, selectedIds, anchorId, focusId }
    : null
}

export const readBlockSelection = (state: EditorState): ProseMirrorSelectionState =>
  selectionKey.getState(state) ?? initialProseMirrorSelectionState

export const setBlockSelectionMeta = (state: EditorState, selection: ProseMirrorSelectionState) =>
  state.tr.setMeta(selectionKey, selection)

export const subscribeBlockSelection = (view: EditorView, update: () => void): (() => void) => {
  updates.set(view, update)
  return () => updates.delete(view)
}

const sameSelection = (
  left: ProseMirrorSelectionState,
  right: ProseMirrorSelectionState,
): boolean =>
  left.mode === right.mode &&
  left.anchorId === right.anchorId &&
  left.focusId === right.focusId &&
  left.selectedIds.length === right.selectedIds.length &&
  left.selectedIds.every((id, index) => id === right.selectedIds[index])

export const blockSelectionReconcilePlugin = new Plugin<ProseMirrorSelectionState>({
  key: selectionKey,
  state: {
    init: () => initialProseMirrorSelectionState,
    apply: (transaction, current) => {
      const explicit = parseSelectionMeta(transaction.getMeta(selectionKey))
      if (explicit !== null) return normalize(explicit, transaction.doc)
      if (transaction.selectionSet)
        return normalize({ ...current, mode: "text", selectedIds: [] }, transaction.doc)
      return transaction.docChanged ? normalize(current, transaction.doc) : current
    },
  },
  props: {
    decorations: (state) => {
      const current = readBlockSelection(state)
      const selected = new Set(current.mode === "blocks" ? current.selectedIds : [])
      const decorations: Decoration[] = []
      state.doc.descendants((node, position) => {
        if (selected.has(String(node.attrs["id"])))
          decorations.push(
            Decoration.node(position, position + node.nodeSize, {
              class: "block-selected",
              "aria-current": "true",
              "data-block-selected": "true",
            }),
          )
        return true
      })
      return DecorationSet.create(state.doc, decorations)
    },
  },
  view: (view) => {
    updates.get(view)?.()
    return {
      update: (updatedView, previousState) => {
        const previous = readBlockSelection(previousState)
        const current = readBlockSelection(updatedView.state)
        if (!sameSelection(previous, current) || !updatedView.state.doc.eq(previousState.doc))
          updates.get(updatedView)?.()
      },
      destroy: () => updates.delete(view),
    }
  },
})

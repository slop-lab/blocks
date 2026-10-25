import type { EditorView } from "prosemirror-view"

type BlockSelection = {
  readonly selectedIds: () => readonly string[]
}

export const createBlockMenuCut =
  (
    view: EditorView,
    selection: BlockSelection,
    onUnavailable: ((message: string) => void) | undefined,
  ): ((expectedIds: readonly string[]) => void) =>
  (expectedIds) => {
    const currentIds = selection.selectedIds()
    if (
      currentIds.length !== expectedIds.length ||
      currentIds.some((id, index) => id !== expectedIds[index])
    ) {
      onUnavailable?.("Cut was canceled because the selection changed.")
      return
    }
    view.focus()
    if (!view.dom.ownerDocument.execCommand("cut"))
      onUnavailable?.("Could not write to the clipboard, so the original content was preserved.")
  }

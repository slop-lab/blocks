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
      onUnavailable?.("선택이 변경되어 잘라내기를 취소했습니다.")
      return
    }
    view.focus()
    if (!view.dom.ownerDocument.execCommand("cut"))
      onUnavailable?.("클립보드에 쓸 수 없어 원본을 유지했습니다.")
  }

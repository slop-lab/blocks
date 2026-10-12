import type { Command } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import {
  duplicateBlockById,
  indentBlocksById,
  moveBlockById,
  moveBlocksById,
  outdentBlocksById,
} from "./block-interaction-commands"

type BlockKeyboardOptions = {
  readonly activeBlockId: () => string | null
  readonly selectedIds: () => readonly string[]
  readonly contains: (blockId: string) => boolean
  readonly blockIndex: (blockId: string) => number
  readonly run: (command: Command) => void
}

export const attachBlockKeyboard = (
  view: EditorView,
  options: BlockKeyboardOptions,
): (() => void) => {
  const onKeyDown = (event: KeyboardEvent) => {
    const selectedIds = options.selectedIds()
    if (selectedIds.length > 0 && event.key === "Tab") {
      event.preventDefault()
      event.stopPropagation()
      options.run(event.shiftKey ? outdentBlocksById(selectedIds) : indentBlocksById(selectedIds))
      return
    }
    const activeId = options.activeBlockId()
    if (
      activeId !== null &&
      event.altKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault()
      event.stopPropagation()
      const index = options.blockIndex(activeId)
      const movingIds = options.contains(activeId) ? selectedIds : [activeId]
      options.run(
        movingIds.length === 1
          ? moveBlockById(activeId, event.key === "ArrowUp" ? index - 1 : index + 2)
          : moveBlocksById(
              movingIds,
              event.key === "ArrowUp"
                ? Math.max(0, Math.min(...movingIds.map(options.blockIndex)) - 1)
                : Math.max(...movingIds.map(options.blockIndex)) + 2,
            ),
      )
      return
    }
    if (
      activeId !== null &&
      (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      event.key.toLocaleLowerCase() === "d"
    ) {
      event.preventDefault()
      event.stopPropagation()
      options.run(duplicateBlockById(activeId))
    }
  }
  view.dom.addEventListener("keydown", onKeyDown)
  return () => view.dom.removeEventListener("keydown", onKeyDown)
}

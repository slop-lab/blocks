import type { ProseMirrorClipboardOptions } from "./prosemirror-clipboard.js"
import type { ProseMirrorSelectionState } from "./prosemirror-selection-state.js"

export type BlockSelectionController = {
  readonly selectFromClick: (blockId: string, event: MouseEvent) => boolean
  readonly activateText: () => void
  readonly replace: (blockIds: readonly string[]) => void
  readonly selectedIds: () => readonly string[]
  readonly value: () => ProseMirrorSelectionState
  readonly contains: (blockId: string) => boolean
  readonly clear: () => void
  readonly reconcile: () => void
  readonly destroy: () => void
}

export type BlockSelectionOptions = ProseMirrorClipboardOptions & {
  readonly onSelectionChange?: (blockIds: readonly string[]) => void
  readonly isContextTarget?: (target: Node) => boolean
  readonly claim?: () => void
  readonly release?: () => void
}

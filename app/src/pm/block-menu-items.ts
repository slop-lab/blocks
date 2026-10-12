import type { Command } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import {
  blockIndexById,
  blockSiblingCountById,
  deleteBlockById,
  duplicateBlockById,
  indentBlocksById,
  moveBlockById,
  outdentBlocksById,
  setBlockTypeById,
} from "./block-interaction-commands"
import type { MenuItem } from "./block-menu"
import { profileForState } from "./profile-plugin"

type MenuItemsOptions = {
  readonly view: EditorView
  readonly blockId: string
  readonly run: (command: Command) => void
  readonly selectedIds: () => readonly string[]
  readonly contains: (blockId: string) => boolean
}

export const blockMenuItems = ({
  view,
  blockId,
  run,
  selectedIds,
  contains,
}: MenuItemsOptions): readonly MenuItem[] => {
  const index = blockIndexById(view.state.doc, blockId)
  if (index < 0) return []
  const siblingCount = blockSiblingCountById(view.state.doc, blockId)
  const schema = view.state.schema
  const profile = profileForState(view.state)
  const defaultRegistration = profile?.registrations.get(profile.defaultTextType)
  const definitions: readonly {
    readonly label: string
    readonly name: string
    readonly attrs: Readonly<Record<string, unknown>>
  }[] = [
    { label: "본문", name: defaultRegistration?.nodeName ?? "paragraph", attrs: {} },
    { label: "제목 1", name: "heading", attrs: { level: 1 } },
    { label: "제목 2", name: "heading", attrs: { level: 2 } },
    { label: "제목 3", name: "heading", attrs: { level: 3 } },
    { label: "인용", name: "blockquote", attrs: {} },
    { label: "코드 블록", name: "code_block", attrs: {} },
  ]
  const types: MenuItem[] = []
  for (const definition of definitions) {
    const type = schema.nodes[definition.name]
    if (type !== undefined)
      types.push({
        label: definition.label,
        action: () => run(setBlockTypeById(blockId, type, definition.attrs)),
      })
  }
  const selection = () => (contains(blockId) ? selectedIds() : [blockId])
  return [
    {
      label: "위로 이동",
      hint: "Alt+↑",
      disabled: index === 0,
      action: () => run(moveBlockById(blockId, index - 1)),
    },
    {
      label: "들여쓰기",
      hint: "Tab",
      action: () => run(indentBlocksById(selection())),
    },
    {
      label: "내어쓰기",
      hint: "Shift+Tab",
      action: () => run(outdentBlocksById(selection())),
    },
    {
      label: "아래로 이동",
      hint: "Alt+↓",
      disabled: index === siblingCount - 1,
      action: () => run(moveBlockById(blockId, index + 2)),
    },
    { label: "복제", hint: "Mod+Shift+D", action: () => run(duplicateBlockById(blockId)) },
    ...types,
    { label: "삭제", danger: true, action: () => run(deleteBlockById(blockId)) },
  ]
}

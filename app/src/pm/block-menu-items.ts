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
import { planBlockWrap, wrapBlocksById } from "./block-wrap-commands"
import { profileForState } from "./profile-plugin"

type MenuItemsOptions = {
  readonly view: EditorView
  readonly blockId: string
  readonly run: (command: Command) => boolean
  readonly selectedIds: () => readonly string[]
  readonly contains: (blockId: string) => boolean
  readonly replaceSelection: (blockIds: readonly string[]) => void
  readonly cut: (blockIds: readonly string[]) => void
  readonly onOpenBlock?: (blockId: string) => void
}

export const blockMenuItems = ({
  view,
  blockId,
  run,
  selectedIds,
  contains,
  replaceSelection,
  cut,
  onOpenBlock,
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
    { label: "Text", name: defaultRegistration?.nodeName ?? "paragraph", attrs: {} },
    { label: "Heading 1", name: "heading", attrs: { level: 1 } },
    { label: "Heading 2", name: "heading", attrs: { level: 2 } },
    { label: "Heading 3", name: "heading", attrs: { level: 3 } },
    { label: "Quote", name: "blockquote", attrs: {} },
    { label: "Code block", name: "code_block", attrs: {} },
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
  const menuSelection = selection()
  const wrapPlan = planBlockWrap(view.state.doc, menuSelection)
  const wrapItems: MenuItem[] = []
  if (wrapPlan.kind === "expanded") {
    wrapItems.push({
      label: `Expand selection (include ${wrapPlan.additionalIds.length} intermediate blocks)`,
      action: () => replaceSelection(wrapPlan.coveredIds),
    })
  } else if (wrapPlan.kind === "exact") {
    for (const registration of profile?.registrations.values() ?? []) {
      const item = registration.insertMenu?.[0]
      if (registration.container === undefined || item === undefined) continue
      const type = schema.nodes[registration.nodeName]
      if (type === undefined) continue
      wrapItems.push({
        label: `Wrap selection → ${item.label}`,
        action: () => {
          const wrapperId = crypto.randomUUID()
          if (run(wrapBlocksById(wrapPlan.coveredIds, type, wrapperId)))
            replaceSelection([wrapperId])
        },
      })
    }
  }
  const navigationItems: readonly MenuItem[] =
    onOpenBlock === undefined ? [] : [{ label: "Focus view", action: () => onOpenBlock(blockId) }]
  return [
    {
      label: "Move up",
      hint: "Alt+↑",
      disabled: index === 0,
      action: () => run(moveBlockById(blockId, index - 1)),
    },
    {
      label: "Indent",
      hint: "Tab",
      action: () => run(indentBlocksById(selection())),
    },
    {
      label: "Outdent",
      hint: "Shift+Tab",
      action: () => run(outdentBlocksById(selection())),
    },
    {
      label: "Move down",
      hint: "Alt+↓",
      disabled: index === siblingCount - 1,
      action: () => run(moveBlockById(blockId, index + 2)),
    },
    { label: "Duplicate", hint: "Mod+Shift+D", action: () => run(duplicateBlockById(blockId)) },
    { label: "Cut", hint: "Mod+X", action: () => cut(menuSelection) },
    ...navigationItems,
    ...wrapItems,
    ...types,
    { label: "Delete", danger: true, action: () => run(deleteBlockById(blockId)) },
  ]
}

import type { Command } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { createBlockControls } from "./block-controls"
import { attachGripDrag } from "./block-drag"
import {
  createBlockAfter,
  deleteBlockById,
  duplicateBlockById,
  moveBlockById,
  setBlockTypeById,
} from "./block-interaction-commands"
import { createBlockMenu, type MenuItem } from "./block-menu"
import { profileForState } from "./profile-plugin"
import { attachSelectionToolbar } from "./selection-toolbar"
import { attachSlashMenu } from "./slash-menu"

export type BlockInteractionOptions = {
  readonly readOnly: boolean
  readonly active?: () => boolean
  readonly onUnavailable?: (message: string) => void
}

const blockElement = (target: EventTarget | null): HTMLElement | null => {
  const element = target instanceof HTMLElement ? target : null
  return element?.closest<HTMLElement>("[data-block-id]") ?? null
}

export const attachBlockInteractions = (
  view: EditorView,
  options: BlockInteractionOptions,
): (() => void) => {
  const ownerDocument = view.dom.ownerDocument
  const { rail, add, grip } = createBlockControls(ownerDocument)
  const menu = createBlockMenu(ownerDocument, "블록 작업")
  let activeId: string | null = null
  let railId: string | null = null

  const hideRail = () => {
    activeId = null
    railId = null
    rail.hidden = true
    menu.close()
  }

  const run = (command: Command) => {
    const handled = command(view.state, view.dispatch, view)
    if (!handled) options.onUnavailable?.("잠긴 블록이거나 현재 위치에서 실행할 수 없습니다.")
    view.focus()
    refreshFromSelection()
  }
  const blockIndex = (blockId: string): number => {
    let found = -1
    view.state.doc.forEach((node, _position, index) => {
      if (node.attrs["id"] === blockId) found = index
    })
    return found
  }
  const showMenu = (blockId: string, trigger: HTMLElement) => {
    const index = blockIndex(blockId)
    if (index < 0) return
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
    const items: readonly MenuItem[] = [
      {
        label: "위로 이동",
        hint: "Alt+↑",
        disabled: index === 0,
        action: () => run(moveBlockById(blockId, index - 1)),
      },
      {
        label: "아래로 이동",
        hint: "Alt+↓",
        disabled: index === view.state.doc.childCount - 1,
        action: () => run(moveBlockById(blockId, index + 2)),
      },
      { label: "복제", hint: "Mod+Shift+D", action: () => run(duplicateBlockById(blockId)) },
      ...types,
      { label: "삭제", danger: true, action: () => run(deleteBlockById(blockId)) },
    ]
    const rect = trigger.getBoundingClientRect()
    menu.open({ point: { x: rect.left, y: rect.bottom + 4 }, items, trigger })
  }
  const showRail = (block: HTMLElement) => {
    const blockId = block.dataset["blockId"]
    if (blockId === undefined || options.readOnly || options.active?.() === false) {
      hideRail()
      return
    }
    const index = blockIndex(blockId)
    const node = index < 0 ? null : view.state.doc.child(index)
    if (node === null) {
      hideRail()
      return
    }
    const locked = node.attrs["locked"] === true
    railId = blockId
    activeId = locked ? null : blockId
    const rect = block.getBoundingClientRect()
    rail.hidden = false
    rail.style.left = `${Math.max(4, rect.left - rail.offsetWidth - 8)}px`
    rail.style.top = `${rect.top}px`
    add.disabled = locked
    grip.disabled = locked
    rail.dataset["locked"] = String(locked)
    if (locked) menu.close()
  }
  const refreshFromSelection = () => {
    const { $from } = view.state.selection
    const node = $from.depth > 0 ? $from.node(1) : ($from.nodeAfter ?? $from.nodeBefore)
    const id = node?.attrs["id"]
    if (typeof id !== "string") return
    const element = view.dom.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`)
    if (element !== null) showRail(element)
  }
  const refreshActiveRail = () => {
    menu.close()
    if (railId === null || rail.hidden) return
    const element = view.dom.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(railId)}"]`)
    if (element === null) hideRail()
    else showRail(element)
  }
  add.addEventListener("pointerdown", (event) => event.preventDefault())
  add.addEventListener("click", () => activeId !== null && run(createBlockAfter(activeId)))
  const dragController = attachGripDrag(view, grip, {
    activeBlockId: () => activeId,
    move: (blockId, gap) => run(moveBlockById(blockId, gap)),
  })
  grip.addEventListener("click", () => {
    if (dragController.consumeClick()) return
    if (activeId !== null) showMenu(activeId, grip)
  })
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      activeId !== null &&
      event.altKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault()
      event.stopPropagation()
      const index = blockIndex(activeId)
      run(moveBlockById(activeId, event.key === "ArrowUp" ? index - 1 : index + 2))
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
      run(duplicateBlockById(activeId))
      return
    }
    if (
      (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) &&
      activeId !== null
    ) {
      event.preventDefault()
      showMenu(activeId, grip)
    }
  }
  const onPointerOver = (event: PointerEvent) => {
    const block = blockElement(event.target)
    if (block !== null && view.dom.contains(block)) showRail(block)
  }
  const onDocumentPointerDown = (event: PointerEvent) => {
    if (!(event.target instanceof Node)) return
    if (
      !view.dom.contains(event.target) &&
      !rail.contains(event.target) &&
      !menu.element.contains(event.target)
    )
      hideRail()
  }
  const onEditorClick = (event: MouseEvent) => {
    if (event.target !== view.dom || options.readOnly || view.state.doc.childCount === 0) return
    const last = view.dom.querySelector<HTMLElement>("[data-block-id]:last-child")
    if (last === null) return
    const id = last.dataset["blockId"]
    if (id !== undefined && event.clientY >= last.getBoundingClientRect().bottom)
      run(createBlockAfter(id))
  }
  view.dom.addEventListener("pointerover", onPointerOver)
  view.dom.addEventListener("focusin", refreshFromSelection)
  view.dom.addEventListener("keyup", refreshFromSelection)
  view.dom.addEventListener("click", onEditorClick)
  view.dom.addEventListener("keydown", onKeyDown)
  ownerDocument.addEventListener("pointerdown", onDocumentPointerDown, true)
  ownerDocument.addEventListener("scroll", refreshActiveRail, true)
  ownerDocument.defaultView?.addEventListener("resize", refreshActiveRail)
  ownerDocument.defaultView?.visualViewport?.addEventListener("resize", refreshActiveRail)
  ownerDocument.defaultView?.visualViewport?.addEventListener("scroll", refreshActiveRail)
  const detachSlash = options.readOnly ? () => undefined : attachSlashMenu(view)
  const detachFormat = attachSelectionToolbar(view, options)
  return () => {
    detachSlash()
    detachFormat()
    menu.destroy()
    dragController.destroy()
    rail.remove()
    view.dom.removeEventListener("pointerover", onPointerOver)
    view.dom.removeEventListener("focusin", refreshFromSelection)
    view.dom.removeEventListener("keyup", refreshFromSelection)
    view.dom.removeEventListener("click", onEditorClick)
    view.dom.removeEventListener("keydown", onKeyDown)
    ownerDocument.removeEventListener("pointerdown", onDocumentPointerDown, true)
    ownerDocument.removeEventListener("scroll", refreshActiveRail, true)
    ownerDocument.defaultView?.removeEventListener("resize", refreshActiveRail)
    ownerDocument.defaultView?.visualViewport?.removeEventListener("resize", refreshActiveRail)
    ownerDocument.defaultView?.visualViewport?.removeEventListener("scroll", refreshActiveRail)
  }
}

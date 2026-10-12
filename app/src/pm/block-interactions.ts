import type { ClipboardEnvelope, ClipboardPolicy } from "@block-editor/interactions"
import type { ReferencePasteContext } from "@block-editor/interactions/prosemirror"
import type { Command } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { createBlockControls } from "./block-controls"
import { attachGripDrag } from "./block-drag"
import {
  blockIndexById,
  blockNodeById,
  createBlockAfter,
  duplicateBlockById,
  indentBlocksById,
  moveBlockById,
  moveBlocksById,
  outdentBlocksById,
} from "./block-interaction-commands"
import { createBlockMenu } from "./block-menu"
import { blockMenuItems } from "./block-menu-items"
import { attachBlockSelection } from "./block-selection"
import { attachSelectionToolbar } from "./selection-toolbar"
import { attachSlashMenu } from "./slash-menu"

export type BlockInteractionOptions = {
  readonly readOnly: boolean
  readonly active?: () => boolean
  readonly onUnavailable?: (message: string) => void
  readonly clipboardPolicy?: ClipboardPolicy
  readonly onDeferredCut?: (
    blockIds: readonly string[],
    envelope: ClipboardEnvelope,
  ) => void | Promise<void>
  readonly onReferencePaste?: (envelope: ClipboardEnvelope, context: ReferencePasteContext) => void
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
  const blockSelection = attachBlockSelection(view, {
    clipboard:
      options.clipboardPolicy ??
      ({
        namespace: "block-editor/default",
        cut: "remove-after-write",
        paste: () => "clone",
      } satisfies ClipboardPolicy),
    ...(options.onDeferredCut === undefined ? {} : { onDeferredCut: options.onDeferredCut }),
    ...(options.onReferencePaste === undefined
      ? {}
      : { onReferencePaste: options.onReferencePaste }),
    ...(options.onUnavailable === undefined ? {} : { onUnavailable: options.onUnavailable }),
  })
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
  const blockIndex = (blockId: string): number => blockIndexById(view.state.doc, blockId)
  const showMenu = (blockId: string, trigger: HTMLElement) => {
    const index = blockIndex(blockId)
    if (index < 0) return
    const items = blockMenuItems({
      view,
      blockId,
      run,
      selectedIds: () => blockSelection.selectedIds(),
      contains: (id) => blockSelection.contains(id),
    })
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
    const node = index < 0 ? null : blockNodeById(view.state.doc, blockId)
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
    move: (blockId, gap) =>
      run(
        moveBlocksById(
          blockSelection.contains(blockId) ? blockSelection.selectedIds() : [blockId],
          gap,
        ),
      ),
  })
  grip.addEventListener("click", (event) => {
    if (dragController.consumeClick()) return
    if (activeId !== null && !blockSelection.selectFromClick(activeId, event))
      showMenu(activeId, grip)
  })
  const onKeyDown = (event: KeyboardEvent) => {
    if (blockSelection.selectedIds().length > 0 && event.key === "Tab") {
      event.preventDefault()
      event.stopPropagation()
      run(
        event.shiftKey
          ? outdentBlocksById(blockSelection.selectedIds())
          : indentBlocksById(blockSelection.selectedIds()),
      )
      return
    }
    if (
      activeId !== null &&
      event.altKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault()
      event.stopPropagation()
      const index = blockIndex(activeId)
      const selectedIds = blockSelection.contains(activeId)
        ? blockSelection.selectedIds()
        : [activeId]
      run(
        selectedIds.length === 1
          ? moveBlockById(activeId, event.key === "ArrowUp" ? index - 1 : index + 2)
          : moveBlocksById(
              selectedIds,
              event.key === "ArrowUp"
                ? Math.max(0, Math.min(...selectedIds.map(blockIndex)) - 1)
                : Math.max(...selectedIds.map(blockIndex)) + 2,
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
    blockSelection.destroy()
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

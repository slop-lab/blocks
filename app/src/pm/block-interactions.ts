import type { Command } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { createBlockControls } from "./block-controls"
import { attachGripDrag } from "./block-drag"
import {
  blockIndexById,
  blockNodeById,
  createBlockAfter,
  moveBlocksToById,
} from "./block-interaction-commands"
import { blockTargetsFor, interactionContextFor } from "./block-interaction-context"
import {
  type BlockInteractionOptions,
  defaultBlockClipboardPolicy,
} from "./block-interaction-options"
import { attachBlockKeyboard } from "./block-keyboard"
import { createBlockMenu } from "./block-menu"
import { createBlockMenuCut } from "./block-menu-cut"
import { blockMenuItems } from "./block-menu-items"
import { attachRailPointerIntent, createSelectionRailRefresher } from "./block-rail-intent"
import { attachBlockSelection } from "./block-selection"
import { createBlockSelectionContext } from "./block-selection-context"
import { createBlockSelectionStatus } from "./block-selection-status"
import { insertionChoices } from "./insertion-catalog"
import { attachSelectionToolbar } from "./selection-toolbar"
import { attachSlashMenu } from "./slash-menu"

export type { BlockInteractionOptions } from "./block-interaction-options"

export const attachBlockInteractions = (
  view: EditorView,
  options: BlockInteractionOptions,
): (() => void) => {
  const ownerDocument = view.dom.ownerDocument
  const { isActive, claim, release, subscribeActive } = interactionContextFor(view, options)
  const { rail, add, grip } = createBlockControls(ownerDocument)
  const menu = createBlockMenu(ownerDocument, "블록 작업")
  const selectionStatus = createBlockSelectionStatus(view.dom)
  const selectionContext = createBlockSelectionContext([rail, menu.element], options.contextId)
  const blockSelection = attachBlockSelection(view, {
    clipboard: options.clipboardPolicy ?? defaultBlockClipboardPolicy,
    ...(options.onDeferredCut === undefined ? {} : { onDeferredCut: options.onDeferredCut }),
    ...(options.interactionContext === undefined
      ? {}
      : { interactionContext: options.interactionContext }),
    ...(options.onReferencePaste === undefined
      ? {}
      : { onReferencePaste: options.onReferencePaste }),
    ...(options.onUnavailable === undefined ? {} : { onUnavailable: options.onUnavailable }),
    isActive,
    claim,
    ...(release === undefined ? {} : { release }),
    isContextTarget: selectionContext.contains,
    onSelectionChange: selectionStatus.update,
  })
  let activeId: string | null = null
  let railId: string | null = null
  let activeRect: DOMRect | null = null
  const { ownsBlock, ownedBlockById } = blockTargetsFor(view)

  const hideRail = () => {
    activeId = null
    railId = null
    rail.hidden = true
    rail.removeAttribute("data-target-block-id")
    menu.close()
  }

  const run = (command: Command) => {
    const handled = command(view.state, view.dispatch, view)
    if (!handled) options.onUnavailable?.("잠긴 블록이거나 현재 위치에서 실행할 수 없습니다.")
    view.focus()
    refreshFromSelection()
    return handled
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
      replaceSelection: blockSelection.replace,
      cut: createBlockMenuCut(view, blockSelection, options.onUnavailable),
      ...(options.onOpenBlock === undefined ? {} : { onOpenBlock: options.onOpenBlock }),
    })
    const rect = trigger.getBoundingClientRect()
    menu.element.dataset["targetBlockId"] = blockId
    menu.open({ point: { x: rect.left, y: rect.bottom + 4 }, items, trigger })
  }
  const showInsertionMenu = (blockId: string, trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect()
    const items = insertionChoices(view).map((choice) => ({
      label: choice.label,
      hint: choice.description,
      action: () =>
        run(
          createBlockAfter(blockId, {
            type: choice.type,
            attrs: choice.attrs,
            ...(choice.container === undefined ? {} : { container: choice.container }),
          }),
        ),
    }))
    if (items.length === 0) return
    menu.element.dataset["targetBlockId"] = blockId
    menu.open({ point: { x: rect.left, y: rect.bottom + 4 }, items, trigger })
  }
  const showRail = (block: HTMLElement) => {
    const blockId = block.dataset["blockId"]
    if (blockId === undefined || !ownsBlock(block) || options.readOnly) {
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
    activeRect = rect
    rail.hidden = false
    rail.dataset["targetBlockId"] = blockId
    const outsideLeft = rect.left - rail.offsetWidth - 8
    const hasLeftGutter = outsideLeft >= 4
    rail.style.left = `${hasLeftGutter ? outsideLeft : rect.left + 4}px`
    rail.style.top = `${hasLeftGutter ? rect.top : Math.max(4, rect.top - rail.offsetHeight - 4)}px`
    add.disabled = locked
    grip.disabled = locked
    rail.dataset["locked"] = String(locked)
    if (locked) menu.close()
  }
  const refreshFromSelection = createSelectionRailRefresher(view, {
    claim,
    ownedBlockById,
    show: showRail,
  })
  const refreshActiveRail = () => {
    menu.close()
    if (railId === null || rail.hidden) return
    const element = ownedBlockById(railId)
    if (element === null) hideRail()
    else showRail(element)
  }
  const onRailPointerDown = (event: PointerEvent) => {
    claim()
    event.preventDefault()
  }
  rail.addEventListener("pointerdown", onRailPointerDown)
  add.addEventListener("click", () => activeId !== null && showInsertionMenu(activeId, add))
  const dragController = attachGripDrag(view, grip, {
    activate: claim,
    activeBlockId: () => activeId,
    begin: (blockId) => {
      if (blockSelection.contains(blockId)) return [...blockSelection.selectedIds()]
      blockSelection.replace([blockId])
      return [blockId]
    },
    childCount: (blockId) => blockNodeById(view.state.doc, blockId)?.childCount ?? 0,
    isCurrent: isActive,
    canMove: (blockIds, target) => moveBlocksToById(blockIds, target)(view.state),
    move: (blockIds, target) => run(moveBlocksToById(blockIds, target)),
  })
  grip.addEventListener("click", (event) => {
    if (dragController.consumeClick()) return
    if (activeId === null) return
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      blockSelection.selectFromClick(activeId, event)
      return
    }
    if (!blockSelection.contains(activeId)) blockSelection.replace([activeId])
    showMenu(activeId, grip)
  })
  const detachKeyboard = attachBlockKeyboard(view, {
    activeBlockId: () => activeId,
    selectedIds: () => blockSelection.selectedIds(),
    contains: (blockId) => blockSelection.contains(blockId),
    blockIndex,
    run,
  })
  const onContextMenuKey = (event: KeyboardEvent) => {
    if (event.target instanceof Element && event.target.closest(".ProseMirror") !== view.dom) return
    if (
      (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) &&
      activeId !== null
    ) {
      event.preventDefault()
      showMenu(activeId, grip)
    }
  }
  const detachRailIntent = attachRailPointerIntent(view, {
    rail,
    targetId: () => railId,
    activeRect: () => activeRect,
    ownsBlock,
    show: showRail,
  })
  const onDocumentPointerDown = (event: PointerEvent) => {
    if (!(event.target instanceof Node)) return
    if (
      !view.dom.contains(event.target) &&
      !rail.contains(event.target) &&
      !menu.element.contains(event.target)
    )
      hideRail()
  }
  view.dom.addEventListener("focusin", refreshFromSelection)
  view.dom.addEventListener("keyup", refreshFromSelection)
  view.dom.addEventListener("keydown", onContextMenuKey)
  ownerDocument.addEventListener("pointerdown", onDocumentPointerDown, true)
  ownerDocument.addEventListener("scroll", refreshActiveRail, true)
  ownerDocument.defaultView?.addEventListener("resize", refreshActiveRail)
  ownerDocument.defaultView?.visualViewport?.addEventListener("resize", refreshActiveRail)
  ownerDocument.defaultView?.visualViewport?.addEventListener("scroll", refreshActiveRail)
  const detachSlash = options.readOnly ? () => undefined : attachSlashMenu(view)
  const detachFormat = attachSelectionToolbar(view, {
    ...options,
    onElement: selectionContext.updateToolbar,
  })
  const detachActive = subscribeActive((active) => {
    if (active) return
    blockSelection.clear()
    hideRail()
  })
  return () => {
    detachActive()
    detachSlash()
    detachFormat()
    detachKeyboard()
    detachRailIntent()
    menu.destroy()
    dragController.destroy()
    blockSelection.destroy()
    selectionStatus.destroy()
    rail.remove()
    rail.removeEventListener("pointerdown", onRailPointerDown)
    view.dom.removeEventListener("focusin", refreshFromSelection)
    view.dom.removeEventListener("keyup", refreshFromSelection)
    view.dom.removeEventListener("keydown", onContextMenuKey)
    ownerDocument.removeEventListener("pointerdown", onDocumentPointerDown, true)
    ownerDocument.removeEventListener("scroll", refreshActiveRail, true)
    ownerDocument.defaultView?.removeEventListener("resize", refreshActiveRail)
    ownerDocument.defaultView?.visualViewport?.removeEventListener("resize", refreshActiveRail)
    ownerDocument.defaultView?.visualViewport?.removeEventListener("scroll", refreshActiveRail)
  }
}

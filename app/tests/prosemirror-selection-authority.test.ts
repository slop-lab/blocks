// @vitest-environment jsdom

import { BLOCK_CLIPBOARD_MIME, InteractionContextArbiter } from "@block-editor/interactions"
import { TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { afterEach, expect, it } from "vitest"
import { createEditorState } from "../src/pm/editor"
import {
  cleanupSelectionViews,
  clipboardEvent,
  createSelectionView,
  trackSelectionView,
} from "./prosemirror-selection-fixture"

afterEach(cleanupSelectionViews)

it("stores none, blocks, and text modes in the production plugin authority", () => {
  const { view, controller } = createSelectionView()
  expect(controller.value()).toEqual({
    mode: "none",
    selectedIds: [],
    anchorId: null,
    focusId: null,
  })

  controller.replace(["first", "second"])
  expect(controller.value().mode).toBe("blocks")
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 4)))

  expect(controller.value()).toEqual({
    mode: "blocks",
    selectedIds: ["first", "second"],
    anchorId: "first",
    focusId: "second",
  })

  controller.activateText()
  expect(controller.value()).toEqual({
    mode: "text",
    selectedIds: [],
    anchorId: "first",
    focusId: "second",
  })
})

it("reconciles selected IDs in plugin apply when the document changes", () => {
  const { view, controller } = createSelectionView()
  controller.replace(["first", "second"])
  const first = view.state.doc.firstChild
  if (first === null) throw new TypeError("Missing first block")

  view.dispatch(view.state.tr.delete(0, first.nodeSize))

  expect(controller.value()).toEqual({
    mode: "blocks",
    selectedIds: ["second"],
    anchorId: null,
    focusId: "second",
  })
})

it("treats a nested editor pointer as outside the parent editor owner", () => {
  const { view, controller } = createSelectionView()
  const parentBlock = view.dom.querySelector<HTMLElement>("[data-block-id='first']")
  if (parentBlock === null) throw new TypeError("Missing parent block")
  const childHost = document.createElement("span")
  parentBlock.append(childHost)
  const child = new EditorView(childHost, {
    state: createEditorState({ document: view.state.doc, readonly: false }),
  })
  trackSelectionView(child)
  controller.replace(["first"])

  child.dom.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }))

  expect(controller.selectedIds()).toEqual([])
})

it("switches native character selection to text mode without structural IDs", () => {
  const { view, controller } = createSelectionView()
  controller.replace(["first"])
  const text = view.dom.querySelector("p")?.firstChild
  if (text === undefined || text === null) throw new TypeError("Missing paragraph text")
  const range = document.createRange()
  range.setStart(text, 1)
  range.setEnd(text, 3)
  document.getSelection()?.removeAllRanges()
  document.getSelection()?.addRange(range)

  document.dispatchEvent(new Event("selectionchange"))

  expect(controller.value().mode).toBe("text")
  expect(controller.selectedIds()).toEqual([])
})

it("ignores a retained native range while a declared context control has focus", () => {
  const control = document.createElement("button")
  document.body.append(control)
  const { view, controller } = createSelectionView({
    isContextTarget: (target) => control === target || control.contains(target),
  })
  const text = view.dom.querySelector("p")?.firstChild
  if (text === undefined || text === null) throw new TypeError("Missing paragraph text")
  const range = document.createRange()
  range.setStart(text, 1)
  range.setEnd(text, 3)
  document.getSelection()?.removeAllRanges()
  document.getSelection()?.addRange(range)
  controller.replace(["first"])
  control.focus()

  document.dispatchEvent(new Event("selectionchange"))

  expect(controller.value().mode).toBe("blocks")
  expect(controller.selectedIds()).toEqual(["first"])
  control.remove()
})

it("ignores a retained native range during declared context pointer activation", () => {
  const control = document.createElement("button")
  document.body.append(control)
  const { view, controller } = createSelectionView({
    isContextTarget: (target) => control === target || control.contains(target),
  })
  const text = view.dom.querySelector("p")?.firstChild
  if (text === undefined || text === null) throw new TypeError("Missing paragraph text")
  const range = document.createRange()
  range.setStart(text, 1)
  range.setEnd(text, 3)
  document.getSelection()?.removeAllRanges()
  document.getSelection()?.addRange(range)
  controller.replace(["first"])

  control.dispatchEvent(
    new PointerEvent("pointerdown", { pointerId: 11, button: 0, bubbles: true }),
  )
  document.dispatchEvent(new Event("selectionchange"))

  expect(controller.value().mode).toBe("blocks")
  expect(controller.selectedIds()).toEqual(["first"])
  document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 11, bubbles: true }))
  control.remove()
})

it("switches Shift-Arrow routing from blocks to native text selection", () => {
  const { view, controller } = createSelectionView()
  controller.replace(["first", "second"])

  view.dom.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowRight",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  )

  expect(controller.value().mode).toBe("text")
  expect(controller.selectedIds()).toEqual([])
})

it("clears consumed pointer flags when pointer capture is cancelled", () => {
  const { view, controller } = createSelectionView()
  const second = view.dom.querySelector<HTMLElement>("[data-block-id='second']")
  const third = view.dom.querySelector<HTMLElement>("[data-block-id='third']")
  if (second === null || third === null) throw new TypeError("Missing block fixture")
  controller.replace(["first"])
  second.dispatchEvent(
    new PointerEvent("pointerdown", {
      pointerId: 7,
      button: 0,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  )

  view.dom.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 7, bubbles: true }))
  third.dispatchEvent(new MouseEvent("click", { button: 0, bubbles: true, cancelable: true }))

  expect(controller.selectedIds()).toEqual([])
})

it("claims an inactive context before applying a block intent", () => {
  const arbiter = new InteractionContextArbiter()
  const context = arbiter.context("prose")
  const { controller } = createSelectionView({
    isActive: context.isActive,
    claim: context.claim,
  })

  controller.replace(["first"])

  expect(context.isActive()).toBe(true)
  expect(controller.selectedIds()).toEqual(["first"])
})

it("coalesces repeated claims and deactivates the previous context", () => {
  const arbiter = new InteractionContextArbiter()
  const prose = arbiter.context("prose")
  const code = arbiter.context("code")
  const proseStates: boolean[] = []
  const unsubscribe = prose.subscribe((active) => proseStates.push(active))

  prose.claim()
  const firstEpoch = arbiter.snapshot.epoch
  prose.claim()
  code.claim()
  unsubscribe()

  expect(firstEpoch).toBe(1)
  expect(arbiter.snapshot).toEqual({ activeId: "code", epoch: 2 })
  expect(prose.isActive()).toBe(false)
  expect(code.isActive()).toBe(true)
  expect(proseStates).toEqual([true, false])
})

it("does not route block clipboard data from an inactive bookmark", () => {
  let active = true
  const { view, controller } = createSelectionView({ isActive: () => active })
  controller.replace(["first"])
  active = false
  const copied = clipboardEvent("copy")

  view.dom.dispatchEvent(copied.event)

  expect(copied.event.defaultPrevented).toBe(false)
  expect(copied.data.has(BLOCK_CLIPBOARD_MIME)).toBe(false)
  expect(controller.selectedIds()).toEqual([])
})

it("releases the active context on an outside pointer", () => {
  const arbiter = new InteractionContextArbiter()
  const context = arbiter.context("prose")
  const { controller } = createSelectionView({
    isActive: context.isActive,
    claim: context.claim,
    release: context.release,
  })
  controller.replace(["first"])

  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }))

  expect(arbiter.snapshot).toEqual({ activeId: null, epoch: 2 })
  expect(controller.selectedIds()).toEqual([])
})

it("excludes readonly nested projection IDs from parent hit routing", () => {
  const { view, controller } = createSelectionView()
  controller.replace(["first"])
  const first = view.dom.querySelector<HTMLElement>("[data-block-id='first']")
  if (first === null) throw new TypeError("Missing first block")
  const projection = document.createElement("div")
  projection.dataset["interactionContextBoundary"] = "true"
  projection.dataset["blockId"] = "source-block"
  first.append(projection)

  projection.dispatchEvent(
    new PointerEvent("pointerdown", {
      button: 0,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  )

  expect(controller.selectedIds()).toEqual([])
  expect(controller.value().selectedIds).not.toContain("source-block")
})

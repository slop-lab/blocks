// @vitest-environment jsdom

import { attachBlockSelection } from "@slop-lab/blocks-interactions/prosemirror"
import { TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { afterEach, describe, expect, it } from "vitest"
import { createEditorState } from "../src/pm/editor"
import { editorSchema } from "../src/pm/schema"
import { attachSelectionToolbar } from "../src/pm/selection-toolbar"

const views: EditorView[] = []
const detachments: Array<() => void> = []

afterEach(() => {
  for (const detach of detachments.splice(0)) detach()
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

const createView = () => {
  const paragraph = editorSchema.nodes.paragraph
  const doc = editorSchema.nodes.doc.create(undefined, [
    paragraph.create({ id: "first", locked: false }, editorSchema.text("First")),
    paragraph.create({ id: "second", locked: false }, editorSchema.text("Second")),
    paragraph.create({ id: "third", locked: false }, editorSchema.text("Third")),
    paragraph.create({ id: "fourth", locked: false }, editorSchema.text("Fourth")),
  ])
  const view = new EditorView(document.body, {
    state: createEditorState({ document: doc, readonly: false }),
  })
  views.push(view)
  const controller = attachBlockSelection(view, {
    clipboard: {
      namespace: "selection-test",
      cut: "remove-after-write",
      paste: () => "clone",
    },
  })
  detachments.push(controller.destroy)
  return { view, controller }
}

describe("native multi-block text selection", () => {
  it("projects a range that fully covers adjacent blocks into structural selection", () => {
    const { view } = createView()
    const paragraphs = view.dom.querySelectorAll("p")
    const first = paragraphs.item(0)
    const second = paragraphs.item(1)
    const range = document.createRange()
    range.setStart(first, 0)
    range.setEnd(second, second.childNodes.length)
    const native = document.getSelection()
    native?.removeAllRanges()
    native?.addRange(range)

    document.dispatchEvent(new Event("selectionchange"))

    expect(Array.from(view.dom.querySelectorAll(".block-selected"))).toHaveLength(2)
  })

  it("leaves a partial cross-block character range as native text selection", () => {
    const { view } = createView()
    const paragraphs = view.dom.querySelectorAll("p")
    const firstText = paragraphs.item(0).firstChild
    const secondText = paragraphs.item(1).firstChild
    if (firstText === null || secondText === null) throw new TypeError("Missing paragraph text")
    const range = document.createRange()
    range.setStart(firstText, 1)
    range.setEnd(secondText, 3)
    const native = document.getSelection()
    native?.removeAllRanges()
    native?.addRange(range)

    document.dispatchEvent(new Event("selectionchange"))

    expect(view.dom.querySelectorAll(".block-selected")).toHaveLength(0)
    expect(document.getSelection()?.toString()).toBe("irstSec")
  })
})

it("replaces selection through the production plugin and exposes semantic DOM state", () => {
  const { view, controller } = createView()

  controller.replace(["first", "second"])

  expect(controller.selectedIds()).toEqual(["first", "second"])
  expect(view.dom.querySelectorAll("[data-block-selected='true']")).toHaveLength(2)
  expect(view.dom.querySelectorAll("[aria-current='true']")).toHaveLength(2)
})

it("clears structural selection when a native character selection becomes active", () => {
  const { view, controller } = createView()
  controller.replace(["first"])
  const paragraph = view.dom.querySelector("p")
  const text = paragraph?.firstChild
  if (text === undefined || text === null) throw new TypeError("Missing paragraph text")
  const range = document.createRange()
  range.setStart(text, 1)
  range.setEnd(text, 3)
  const native = document.getSelection()
  native?.removeAllRanges()
  native?.addRange(range)

  document.dispatchEvent(new Event("selectionchange"))

  expect(controller.selectedIds()).toEqual([])
  expect(native?.toString()).toBe("ir")
})

it("clears structural selection when pointer routing leaves the editing context", () => {
  const { controller } = createView()
  const outside = document.createElement("button")
  document.body.append(outside)
  controller.replace(["first"])

  outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }))

  expect(controller.selectedIds()).toEqual([])
})

it("preserves structural selection when pointer-down starts on selected blank block surface", () => {
  const { view, controller } = createView()
  const first = view.dom.querySelector<HTMLElement>("[data-block-id='first']")
  if (first === null) throw new TypeError("Missing first block")
  controller.replace(["first"])
  const pointerDown = new MouseEvent("pointerdown", {
    button: 0,
    bubbles: true,
    cancelable: true,
    clientX: 200,
    clientY: 20,
  })
  Object.defineProperty(pointerDown, "pointerId", { value: 1 })

  first.dispatchEvent(pointerDown)

  expect(controller.selectedIds()).toEqual(["first"])
})

it("preserves Ctrl toggle and Shift range across native pointer, mouse, and click ordering", () => {
  const { view, controller } = createView()
  const dispatchClickSequence = (
    id: string,
    modifiers: { ctrlKey?: boolean; shiftKey?: boolean },
  ) => {
    const target = view.dom.querySelector<HTMLElement>(`[data-block-id='${id}']`)
    if (target === null) throw new TypeError(`Missing ${id} block`)
    const pointerDown = new MouseEvent("pointerdown", {
      button: 0,
      bubbles: true,
      cancelable: true,
      ...modifiers,
    })
    Object.defineProperty(pointerDown, "pointerId", { value: 1 })
    target.dispatchEvent(pointerDown)
    for (const type of ["mousedown", "mouseup", "click"])
      target.dispatchEvent(
        new MouseEvent(type, { button: 0, bubbles: true, cancelable: true, ...modifiers }),
      )
  }

  dispatchClickSequence("second", { ctrlKey: true })
  expect(controller.selectedIds()).toEqual(["second"])

  dispatchClickSequence("fourth", { shiftKey: true })
  expect(controller.selectedIds()).toEqual(["second", "third", "fourth"])

  dispatchClickSequence("second", { ctrlKey: true })
  expect(controller.selectedIds()).toEqual(["third", "fourth"])
})

it("routes Mod-K to link editing when the active editor owns a text range", () => {
  const paragraph = editorSchema.nodes.paragraph
  const doc = editorSchema.nodes.doc.create(undefined, [
    paragraph.create({ id: "linked", locked: false }, editorSchema.text("Linked text")),
  ])
  const initial = createEditorState({ document: doc, readonly: false })
  const view = new EditorView(document.body, {
    state: initial.apply(initial.tr.setSelection(TextSelection.create(doc, 1, 7))),
  })
  views.push(view)
  detachments.push(attachSelectionToolbar(view, { readOnly: false }))

  view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }),
  )

  const input = document.querySelector<HTMLInputElement>("[aria-label='링크 주소']")
  expect(input?.closest("form")?.hidden).toBe(false)
  expect(document.activeElement).toBe(input)
})

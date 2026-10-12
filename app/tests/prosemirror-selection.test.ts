// @vitest-environment jsdom

import { attachBlockSelection } from "@block-editor/interactions/prosemirror"
import { EditorState, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { afterEach, describe, expect, it } from "vitest"
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
  ])
  const view = new EditorView(document.body, {
    state: EditorState.create({ schema: editorSchema, doc }),
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

it("replaces selection with an explicit preview and exposes semantic DOM state", () => {
  const { view, controller } = createView()

  controller.replace(["first", "second"])

  expect(controller.selectedIds()).toEqual(["first", "second"])
  expect(view.dom.querySelectorAll("[data-block-selected='true']")).toHaveLength(2)
  expect(view.dom.querySelectorAll("[aria-current='true']")).toHaveLength(2)
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

it("routes Mod-K to link editing when the active editor owns a text range", () => {
  const paragraph = editorSchema.nodes.paragraph
  const doc = editorSchema.nodes.doc.create(undefined, [
    paragraph.create({ id: "linked", locked: false }, editorSchema.text("Linked text")),
  ])
  const view = new EditorView(document.body, {
    state: EditorState.create({
      schema: editorSchema,
      doc,
      selection: TextSelection.create(doc, 1, 7),
    }),
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

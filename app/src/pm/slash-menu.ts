import { Fragment } from "prosemirror-model"
import { TextSelection } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { parseSlashQuery } from "./block-interaction-commands"
import { createBlockMenu, type MenuController, type MenuItem } from "./block-menu"
import { type InsertionChoice, insertionChoices } from "./insertion-catalog"

const applyChoice = (view: EditorView, choice: InsertionChoice): void => {
  const query = parseSlashQuery(view.state, view.composing)
  if (query === null) return
  const position = query.from - 1
  const node = view.state.doc.nodeAt(position)
  if (node === null) return
  const content = node.content.cut(query.to - query.from)
  if (choice.wrapType !== undefined) {
    const child = node.type.create({ ...node.attrs, id: crypto.randomUUID() }, content, node.marks)
    const item = choice.wrapType.createAndFill(undefined, child)
    if (item === null) return
    const wrapped = choice.type.createAndFill(choice.attrs, item)
    if (wrapped === null) return
    const transaction = view.state.tr.replaceWith(position, position + node.nodeSize, wrapped)
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(position + 2)))
    view.dispatch(transaction.setMeta("origin", "local").scrollIntoView())
    view.focus()
    return
  }
  if (choice.container !== undefined) {
    const child = node.type.create({ ...node.attrs, id: crypto.randomUUID() }, content, node.marks)
    if (!choice.type.validContent(Fragment.from(child))) return
    const wrapped = choice.type.create(
      { id: crypto.randomUUID(), locked: false, ...choice.attrs },
      child,
    )
    const transaction = view.state.tr.replaceWith(position, position + node.nodeSize, wrapped)
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(position + 2)))
    view.dispatch(transaction.setMeta("origin", "local").scrollIntoView())
    view.focus()
    return
  }
  if (!choice.type.validContent(content)) return
  const transaction = view.state.tr.delete(query.from, query.to)
  transaction.setNodeMarkup(position, choice.type, { ...node.attrs, ...choice.attrs })
  view.dispatch(transaction.setMeta("origin", "local").scrollIntoView())
  view.focus()
}

export const attachSlashMenu = (
  view: EditorView,
  menu: MenuController = createBlockMenu(view.dom.ownerDocument, "Insert block menu"),
): (() => void) => {
  const update = () => {
    const query = parseSlashQuery(view.state, view.composing)
    if (query === null) {
      if (menu.element.dataset["slash"] === "true") menu.close()
      return
    }
    const normalized = query.query.toLocaleLowerCase()
    const items: readonly MenuItem[] = insertionChoices(view)
      .filter((choice) =>
        `${choice.label} ${choice.description} ${choice.keywords.join(" ")}`
          .toLocaleLowerCase()
          .includes(normalized),
      )
      .map((choice) => ({ label: choice.label, action: () => applyChoice(view, choice) }))
    if (items.length === 0) {
      menu.close()
      return
    }
    const caret = view.coordsAtPos(query.to)
    menu.element.dataset["slash"] = "true"
    menu.open({ point: { x: caret.left, y: caret.bottom + 8 }, items, focusFirst: false })
  }
  const scheduleUpdate = () => queueMicrotask(update)
  const onKeyDown = (event: KeyboardEvent) => {
    if (menu.element.dataset["slash"] !== "true" || menu.element.hidden) return
    if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) {
      if (event.key === "Enter") {
        const active = menu.element.ownerDocument.activeElement
        if (active instanceof HTMLButtonElement && menu.element.contains(active)) active.click()
      } else if (event.key === "Escape") menu.close(true)
      else
        menu.element.dispatchEvent(new KeyboardEvent("keydown", { key: event.key, bubbles: true }))
      event.preventDefault()
      event.stopPropagation()
    }
  }
  view.dom.addEventListener("input", scheduleUpdate)
  view.dom.addEventListener("keyup", scheduleUpdate)
  view.dom.addEventListener("keydown", onKeyDown, true)
  return () => {
    view.dom.removeEventListener("input", scheduleUpdate)
    view.dom.removeEventListener("keyup", scheduleUpdate)
    view.dom.removeEventListener("keydown", onKeyDown, true)
    menu.destroy()
  }
}

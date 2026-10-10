import type { NodeType } from "prosemirror-model"
import type { EditorView } from "prosemirror-view"
import { parseSlashQuery } from "./block-interaction-commands"
import { createBlockMenu, type MenuController, type MenuItem } from "./block-menu"

type SlashChoice = {
  readonly label: string
  readonly keywords: string
  readonly type: NodeType
  readonly attrs?: Readonly<Record<string, unknown>>
}

const choicesFor = (view: EditorView): readonly SlashChoice[] => {
  const { nodes } = view.state.schema
  const definitions = [
    { label: "본문", keywords: "문단 paragraph", type: nodes["paragraph"] },
    {
      label: "제목 1",
      keywords: "큰 제목 heading h1",
      type: nodes["heading"],
      attrs: { level: 1 },
    },
    {
      label: "제목 2",
      keywords: "중간 제목 heading h2",
      type: nodes["heading"],
      attrs: { level: 2 },
    },
    {
      label: "제목 3",
      keywords: "작은 제목 heading h3",
      type: nodes["heading"],
      attrs: { level: 3 },
    },
    { label: "인용", keywords: "인용 quote", type: nodes["blockquote"] },
    { label: "코드 블록", keywords: "코드 code", type: nodes["code_block"] },
  ]
  const choices: SlashChoice[] = []
  for (const definition of definitions) {
    if (definition.type === undefined) continue
    choices.push({
      label: definition.label,
      keywords: definition.keywords,
      type: definition.type,
      ...(definition.attrs === undefined ? {} : { attrs: definition.attrs }),
    })
  }
  return choices
}

const applyChoice = (view: EditorView, choice: SlashChoice): void => {
  const query = parseSlashQuery(view.state, view.composing)
  if (query === null) return
  const position = query.from - 1
  const node = view.state.doc.nodeAt(position)
  if (node === null || !choice.type.validContent(node.content.cut(query.to - query.from))) return
  const transaction = view.state.tr.delete(query.from, query.to)
  transaction.setNodeMarkup(position, choice.type, { ...node.attrs, ...choice.attrs })
  view.dispatch(transaction.setMeta("origin", "local").scrollIntoView())
  view.focus()
}

export const attachSlashMenu = (
  view: EditorView,
  menu: MenuController = createBlockMenu(view.dom.ownerDocument, "블록 삽입 메뉴"),
): (() => void) => {
  const update = () => {
    const query = parseSlashQuery(view.state, view.composing)
    if (query === null) {
      if (menu.element.dataset["slash"] === "true") menu.close()
      return
    }
    const normalized = query.query.toLocaleLowerCase()
    const items: readonly MenuItem[] = choicesFor(view)
      .filter((choice) =>
        `${choice.label} ${choice.keywords}`.toLocaleLowerCase().includes(normalized),
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

import { toggleMark } from "prosemirror-commands"
import type { MarkType } from "prosemirror-model"
import { NodeSelection } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { safeLinkHref } from "./block-interaction-commands"
import { captureLinkTarget, isCurrentLinkTarget, type LinkTarget } from "./link-selection"

export type SelectionToolbarOptions = {
  readonly readOnly: boolean
  readonly active?: () => boolean
}

const iconButton = (ownerDocument: Document, label: string, text: string): HTMLButtonElement => {
  const button = ownerDocument.createElement("button")
  button.type = "button"
  button.className = "selection-toolbar__button"
  button.ariaLabel = label
  button.title = label
  button.textContent = text
  return button
}

export const attachSelectionToolbar = (
  view: EditorView,
  options: SelectionToolbarOptions,
): (() => void) => {
  if (options.readOnly) return () => undefined
  const ownerDocument = view.dom.ownerDocument
  const toolbar = ownerDocument.createElement("div")
  toolbar.className = "selection-toolbar"
  toolbar.role = "toolbar"
  toolbar.ariaLabel = "선택한 글자 서식"
  toolbar.hidden = true
  ownerDocument.body.append(toolbar)
  let detachLinkShortcut: () => void = () => {}

  const runMark = (mark: MarkType) => {
    toggleMark(mark)(view.state, view.dispatch, view)
    view.focus()
    update()
  }
  const marks = [
    { type: view.state.schema.marks["strong"], label: "굵게", text: "B" },
    { type: view.state.schema.marks["em"], label: "기울임", text: "I" },
    { type: view.state.schema.marks["code"], label: "인라인 코드", text: "<>" },
  ]
  for (const item of marks) {
    const mark = item.type
    if (mark === undefined) continue
    const button = iconButton(ownerDocument, item.label, item.text)
    button.addEventListener("pointerdown", (event) => event.preventDefault())
    button.addEventListener("click", () => runMark(mark))
    toolbar.append(button)
  }

  const linkMark = view.state.schema.marks["link"]
  if (linkMark !== undefined) {
    let target: LinkTarget | null = null
    const linkButton = iconButton(ownerDocument, "링크 편집", "Link")
    const form = ownerDocument.createElement("form")
    form.className = "selection-toolbar__link"
    form.hidden = true
    const input = ownerDocument.createElement("input")
    input.type = "text"
    input.inputMode = "url"
    input.placeholder = "https:// 또는 /경로"
    input.ariaLabel = "링크 주소"
    const error = ownerDocument.createElement("span")
    error.className = "selection-toolbar__error"
    error.role = "alert"
    const apply = ownerDocument.createElement("button")
    apply.type = "submit"
    apply.textContent = "적용"
    const remove = ownerDocument.createElement("button")
    remove.type = "button"
    remove.textContent = "링크 제거"
    const cancel = ownerDocument.createElement("button")
    cancel.type = "button"
    cancel.textContent = "취소"
    form.append(input, apply, remove, cancel, error)
    linkButton.addEventListener("pointerdown", (event) => event.preventDefault())
    const openLinkForm = () => {
      target = captureLinkTarget(view.state, linkMark)
      if (target === null) return
      input.value = target.href
      error.textContent = ""
      form.hidden = false
      toolbar.classList.add("selection-toolbar--link-open")
      update()
      input.focus()
    }
    linkButton.addEventListener("click", openLinkForm)
    const onLinkShortcut = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLocaleLowerCase() === "k" &&
        captureLinkTarget(view.state, linkMark) !== null
      ) {
        event.preventDefault()
        event.stopPropagation()
        openLinkForm()
      }
    }
    view.dom.addEventListener("keydown", onLinkShortcut)
    detachLinkShortcut = () => view.dom.removeEventListener("keydown", onLinkShortcut)
    const applyTarget = (href: string | null) => {
      if (target === null || !isCurrentLinkTarget(view.state, target)) {
        error.textContent = "선택한 글자가 변경되었습니다. 다시 선택해 주세요."
        return
      }
      const transaction =
        href === null
          ? view.state.tr.removeMark(target.from, target.to, linkMark)
          : view.state.tr.addMark(target.from, target.to, linkMark.create({ href }))
      view.dispatch(transaction.setMeta("origin", "local"))
      target = null
      form.hidden = true
      toolbar.classList.remove("selection-toolbar--link-open")
      error.textContent = ""
      view.focus()
      update()
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault()
      if (input.value.trim() === "") {
        applyTarget(null)
        return
      }
      const href = safeLinkHref(input.value)
      if (href === null) {
        error.textContent = "안전한 웹, 메일 또는 문서 내부 주소를 입력하세요."
        return
      }
      applyTarget(href)
    })
    remove.addEventListener("click", () => applyTarget(null))
    cancel.addEventListener("click", () => {
      target = null
      form.hidden = true
      toolbar.classList.remove("selection-toolbar--link-open")
      error.textContent = ""
      view.focus()
      update()
    })
    toolbar.append(linkButton, form)
  }

  function update(): void {
    const selection = view.state.selection
    const active = options.active?.() ?? true
    const textSelection = !selection.empty && !(selection instanceof NodeSelection)
    const code = selection.$from.parent.type.spec.code === true
    if (
      !active ||
      !textSelection ||
      code ||
      view.composing ||
      view.dom.getClientRects().length === 0
    ) {
      toolbar.hidden = true
      return
    }
    toolbar.hidden = false
    const start = view.coordsAtPos(selection.from)
    const end = view.coordsAtPos(selection.to)
    const width = toolbar.getBoundingClientRect().width
    const viewport = ownerDocument.defaultView
    const center = (start.left + end.right) / 2
    const viewportWidth = viewport?.innerWidth ?? center
    const left = Math.max(8, Math.min(center - width / 2, viewportWidth - width - 8))
    toolbar.style.left = `${left}px`
    const overflow = toolbar.getBoundingClientRect().right - (viewportWidth - 8)
    if (overflow > 0) toolbar.style.left = `${Math.max(8, left - overflow)}px`
    toolbar.style.top = `${Math.max(8, Math.min(start.top, end.top) - toolbar.offsetHeight - 8)}px`
  }

  let updateFrame = 0
  const schedule = () => {
    ownerDocument.defaultView?.cancelAnimationFrame(updateFrame)
    updateFrame = ownerDocument.defaultView?.requestAnimationFrame(update) ?? 0
  }
  view.dom.addEventListener("mouseup", schedule)
  view.dom.addEventListener("keyup", schedule)
  view.dom.addEventListener("focusin", schedule)
  ownerDocument.addEventListener("selectionchange", schedule)
  ownerDocument.addEventListener("scroll", schedule, true)
  ownerDocument.defaultView?.addEventListener("resize", schedule)
  ownerDocument.defaultView?.visualViewport?.addEventListener("resize", schedule)
  ownerDocument.defaultView?.visualViewport?.addEventListener("scroll", schedule)
  return () => {
    ownerDocument.defaultView?.cancelAnimationFrame(updateFrame)
    view.dom.removeEventListener("mouseup", schedule)
    view.dom.removeEventListener("keyup", schedule)
    view.dom.removeEventListener("focusin", schedule)
    ownerDocument.removeEventListener("selectionchange", schedule)
    ownerDocument.removeEventListener("scroll", schedule, true)
    ownerDocument.defaultView?.removeEventListener("resize", schedule)
    ownerDocument.defaultView?.visualViewport?.removeEventListener("resize", schedule)
    ownerDocument.defaultView?.visualViewport?.removeEventListener("scroll", schedule)
    detachLinkShortcut()
    toolbar.remove()
  }
}

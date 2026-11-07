import { toggleMark } from "prosemirror-commands"
import type { MarkType } from "prosemirror-model"
import { NodeSelection, TextSelection } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { safeLinkHref } from "./block-interaction-commands"
import { captureLinkTarget, isCurrentLinkTarget, type LinkTarget } from "./link-selection"

export type SelectionToolbarOptions = {
  readonly readOnly: boolean
  readonly isActive?: () => boolean
  readonly onElement?: (element: HTMLElement | null) => void
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
  toolbar.ariaLabel = "Format selected text"
  toolbar.hidden = true
  ownerDocument.body.append(toolbar)
  options.onElement?.(toolbar)
  let detachLinkShortcut: () => void = () => {}

  const runMark = (mark: MarkType) => {
    toggleMark(mark)(view.state, view.dispatch, view)
    view.focus()
    update()
  }
  const marks = [
    { type: view.state.schema.marks["strong"], label: "Bold", text: "B" },
    { type: view.state.schema.marks["em"], label: "Italic", text: "I" },
    { type: view.state.schema.marks["code"], label: "Inline code", text: "<>" },
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
  let linkTarget: LinkTarget | null = null
  if (linkMark !== undefined) {
    const linkButton = iconButton(ownerDocument, "Edit link", "Link")
    const form = ownerDocument.createElement("form")
    form.className = "selection-toolbar__link"
    form.hidden = true
    const input = ownerDocument.createElement("input")
    input.type = "text"
    input.inputMode = "url"
    input.placeholder = "https:// or /path"
    input.ariaLabel = "Link address"
    const error = ownerDocument.createElement("span")
    error.className = "selection-toolbar__error"
    error.role = "alert"
    const apply = ownerDocument.createElement("button")
    apply.type = "submit"
    apply.textContent = "Apply"
    const remove = ownerDocument.createElement("button")
    remove.type = "button"
    remove.textContent = "Remove link"
    const cancel = ownerDocument.createElement("button")
    cancel.type = "button"
    cancel.textContent = "Cancel"
    form.append(input, apply, remove, cancel, error)
    linkButton.addEventListener("pointerdown", (event) => event.preventDefault())
    const openLinkForm = () => {
      linkTarget = captureLinkTarget(view.state, linkMark)
      if (linkTarget === null) return
      input.value = linkTarget.href
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
      if (linkTarget === null || !isCurrentLinkTarget(view.state, linkTarget)) {
        error.textContent = "The selected text changed. Select it again."
        return
      }
      const transaction =
        href === null
          ? view.state.tr.removeMark(linkTarget.from, linkTarget.to, linkMark)
          : view.state.tr.addMark(linkTarget.from, linkTarget.to, linkMark.create({ href }))
      transaction.setSelection(
        TextSelection.create(transaction.doc, linkTarget.from, linkTarget.to),
      )
      view.dispatch(transaction.setMeta("origin", "local"))
      linkTarget = null
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
        error.textContent = "Enter a safe web, email, or internal document address."
        return
      }
      applyTarget(href)
    })
    remove.addEventListener("click", () => applyTarget(null))
    cancel.addEventListener("click", () => {
      if (linkTarget !== null && isCurrentLinkTarget(view.state, linkTarget))
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, linkTarget.from, linkTarget.to),
          ),
        )
      linkTarget = null
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
    const active = options.isActive?.() ?? true
    const linkFormOpen = toolbar.classList.contains("selection-toolbar--link-open")
    const textSelection = !selection.empty && !(selection instanceof NodeSelection)
    const code = selection.$from.parent.type.spec.code === true
    if (
      !active ||
      (!textSelection && !linkFormOpen) ||
      code ||
      view.composing ||
      view.dom.getClientRects().length === 0
    ) {
      toolbar.hidden = true
      return
    }
    toolbar.hidden = false
    const from = linkFormOpen && linkTarget !== null ? linkTarget.from : selection.from
    const to = linkFormOpen && linkTarget !== null ? linkTarget.to : selection.to
    const start = view.coordsAtPos(from)
    const end = view.coordsAtPos(to)
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
    options.onElement?.(null)
    toolbar.remove()
  }
}

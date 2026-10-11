export type MenuItem = {
  readonly label: string
  readonly hint?: string
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly action: () => void
}

export type MenuPoint = { readonly x: number; readonly y: number }

export type MenuRequest = {
  readonly point: MenuPoint
  readonly items: readonly MenuItem[]
  readonly trigger?: HTMLElement
  readonly focusFirst?: boolean
}

export type MenuController = {
  readonly open: (request: MenuRequest) => void
  readonly close: (restoreFocus?: boolean) => void
  readonly element: HTMLElement
  readonly destroy: () => void
}

const enabledItems = (menu: HTMLElement): readonly HTMLButtonElement[] => [
  ...menu.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)"),
]

export const createBlockMenu = (ownerDocument: Document, label: string): MenuController => {
  const menu = ownerDocument.createElement("div")
  menu.className = "block-menu"
  menu.role = "menu"
  menu.ariaLabel = label
  menu.hidden = true
  ownerDocument.body.append(menu)
  let returnFocus: HTMLElement | undefined

  const close = (restoreFocus = false) => {
    menu.hidden = true
    menu.replaceChildren()
    if (restoreFocus) returnFocus?.focus({ preventScroll: true })
    returnFocus = undefined
  }

  const open = ({ point, items, trigger, focusFirst = true }: MenuRequest) => {
    close()
    returnFocus = trigger
    for (const item of items) {
      const button = ownerDocument.createElement("button")
      button.type = "button"
      button.role = "menuitem"
      button.setAttribute("aria-label", item.label)
      button.className = item.danger
        ? "block-menu__item block-menu__item--danger"
        : "block-menu__item"
      button.disabled = item.disabled === true
      const text = ownerDocument.createElement("span")
      text.textContent = item.label
      button.append(text)
      if (item.hint !== undefined) {
        const hint = ownerDocument.createElement("kbd")
        hint.setAttribute("aria-hidden", "true")
        hint.textContent = item.hint
        button.append(hint)
      }
      button.addEventListener("pointermove", () => button.focus({ preventScroll: true }))
      button.addEventListener("click", () => {
        close()
        item.action()
      })
      menu.append(button)
    }
    menu.hidden = false
    menu.style.left = `${point.x}px`
    menu.style.top = `${point.y}px`
    const rect = menu.getBoundingClientRect()
    const viewport = ownerDocument.defaultView
    if (viewport !== null) {
      const padding = 8
      menu.style.left = `${Math.max(padding, Math.min(point.x, viewport.innerWidth - rect.width - padding))}px`
      menu.style.top = `${Math.max(padding, Math.min(point.y, viewport.innerHeight - rect.height - padding))}px`
    }
    if (focusFirst) enabledItems(menu)[0]?.focus({ preventScroll: true })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (menu.hidden) return
    if (event.key === "Escape") {
      event.preventDefault()
      close(true)
      return
    }
    if (event.key === "Tab") {
      close()
      return
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    event.preventDefault()
    const items = enabledItems(menu)
    if (items.length === 0) return
    const active = ownerDocument.activeElement
    const current = active instanceof HTMLButtonElement ? items.indexOf(active) : -1
    const step = event.key === "ArrowDown" ? 1 : -1
    items[(current + step + items.length) % items.length]?.focus({ preventScroll: true })
  }
  const onPointerDown = (event: PointerEvent) => {
    if (!menu.hidden && event.target instanceof Node && !menu.contains(event.target)) close()
  }
  menu.addEventListener("keydown", onKeyDown)
  ownerDocument.addEventListener("pointerdown", onPointerDown, true)

  return {
    open,
    close,
    element: menu,
    destroy: () => {
      ownerDocument.removeEventListener("pointerdown", onPointerDown, true)
      menu.remove()
    },
  }
}

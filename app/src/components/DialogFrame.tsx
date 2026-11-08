import { Cross2Icon } from "@radix-ui/react-icons"
import { type ReactNode, useEffect, useRef } from "react"

type DialogFrameProps = {
  readonly titleId: string
  readonly eyebrow: string
  readonly title: string
  readonly onClose: () => void
  readonly children: ReactNode
  readonly wide?: boolean
}

export const DialogFrame = ({
  titleId,
  eyebrow,
  title,
  onClose,
  children,
  wide = false,
}: DialogFrameProps) => {
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const previouslyFocused = document.activeElement
    dialogRef.current?.focus()
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [])

  return (
    <div className="dialog-layer" role="presentation">
      <section
        ref={dialogRef}
        className={wide ? "dialog dialog--wide" : "dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose()
          if (event.key !== "Tab") return
          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
            ),
          )
          const first = focusable[0]
          const last = focusable.at(-1)
          if (first === undefined || last === undefined) return
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <header>
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={onClose}>
            <Cross2Icon />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}

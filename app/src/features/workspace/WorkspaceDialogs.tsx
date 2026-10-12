import { Cross2Icon, PlusIcon } from "@radix-ui/react-icons"
import { useEffect, useRef } from "react"

type Props = {
  readonly createOpen: boolean
  readonly newTitle: string
  readonly onTitle: (value: string) => void
  readonly onCreate: () => void
  readonly onCloseCreate: () => void
}

export const WorkspaceDialogs = (props: Props) => {
  const createInput = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!props.createOpen) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    queueMicrotask(() => createInput.current?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        props.onCloseCreate()
        return
      }
      if (event.key !== "Tab" || dialog.current === null) return
      const focusable = Array.from(
        dialog.current.querySelectorAll<HTMLElement>("button, input, [tabindex]"),
      ).filter((element) => element.tabIndex >= 0 && !element.hasAttribute("disabled"))
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
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      opener?.focus()
    }
  }, [props.createOpen, props.onCloseCreate])

  if (!props.createOpen) return null
  return (
    <div className="structured-dialog-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-page-title"
        aria-describedby="create-page-description"
        className="structured-dialog"
        ref={dialog}
      >
        <header>
          <h2 id="create-page-title">하위 페이지 만들기</h2>
          <button type="button" aria-label="닫기" onClick={props.onCloseCreate}>
            <Cross2Icon />
          </button>
        </header>
        <p id="create-page-description">현재 페이지 아래에 새 문서 페이지를 만듭니다.</p>
        <label>
          페이지 제목
          <input
            ref={createInput}
            value={props.newTitle}
            onChange={(event) => props.onTitle(event.target.value)}
          />
        </label>
        <button className="button button--primary" type="button" onClick={props.onCreate}>
          <PlusIcon /> 만들기
        </button>
      </section>
    </div>
  )
}

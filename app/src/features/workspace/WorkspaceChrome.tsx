import { ResetIcon } from "@radix-ui/react-icons"
import type { Page } from "@slop-lab/blocks-workspace"
import { useEffect, useRef, useState } from "react"

export const WorkspaceTopbar = ({
  title,
  status,
  onTitle,
  onCompositionChange,
}: {
  readonly title: string
  readonly status: string
  readonly onTitle: (title: string) => void
  readonly onCompositionChange: (composing: boolean) => void
}) => {
  const [draft, setDraft] = useState(title)
  const composing = useRef(false)
  const cancelled = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!composing.current && document.activeElement !== input.current) setDraft(title)
  }, [title])
  const commit = (value: string) => {
    const next = value.trim()
    if (next.length === 0) {
      setDraft(title)
      return
    }
    setDraft(next)
    if (next !== title) onTitle(next)
  }
  return (
    <header className="structured-topbar">
      <div>
        <span className="eyebrow">문서와 데이터베이스</span>
        <h1>
          <span className="structured-topbar__title-text" aria-hidden="true">
            {draft}
          </span>
          <input
            ref={input}
            aria-label="페이지 제목"
            maxLength={160}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onFocus={() => {
              cancelled.current = false
            }}
            onBlur={(event) => {
              if (cancelled.current) {
                cancelled.current = false
                return
              }
              if (!composing.current) commit(event.currentTarget.value)
            }}
            onCompositionStart={() => {
              composing.current = true
              onCompositionChange(true)
            }}
            onCompositionEnd={(event) => {
              commit(event.currentTarget.value)
              composing.current = false
              onCompositionChange(false)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !composing.current) {
                event.preventDefault()
                event.currentTarget.blur()
              }
              if (event.key === "Escape" && !composing.current) {
                event.preventDefault()
                cancelled.current = true
                setDraft(title)
                event.currentTarget.blur()
              }
            }}
          />
        </h1>
      </div>
      <span className="status-badge" role="status">
        {status}
      </span>
    </header>
  )
}

export const WorkspaceTrash = ({
  pages,
  onRestore,
}: {
  readonly pages: readonly Page[]
  readonly onRestore: (id: string) => void
}) =>
  pages.length === 0 ? null : (
    <aside className="structured-trash">
      <strong>보관함</strong>
      {pages.map((page) => (
        <button type="button" key={page.id} onClick={() => onRestore(page.id)}>
          <ResetIcon /> {page.title} 복원
        </button>
      ))}
    </aside>
  )

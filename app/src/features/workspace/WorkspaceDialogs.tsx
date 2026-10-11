import type { Database, SyncedSource, Workspace } from "@block-editor/workspace"
import { Cross2Icon, PlusIcon } from "@radix-ui/react-icons"
import { useEffect, useRef } from "react"
import { WorkspaceEditor } from "./WorkspaceEditor"

type Props = {
  readonly createOpen: boolean
  readonly newTitle: string
  readonly workspace: Workspace
  readonly databases: readonly Database[]
  readonly sources: readonly SyncedSource[]
  readonly sharedSource: SyncedSource | null
  readonly onTitle: (value: string) => void
  readonly onCreate: () => void
  readonly onCloseCreate: () => void
  readonly onSharedSource: (source: SyncedSource) => void
  readonly onCompositionChange: (composing: boolean) => void
  readonly sharedReturnFocus: HTMLElement | null
  readonly onCloseShared: () => void
}

type DialogFocus = {
  readonly open: boolean
  readonly onClose: () => void
  readonly initialFocus: React.RefObject<HTMLElement | null>
  readonly returnFocus?: HTMLElement | null
}

const useDialogFocus = ({ open, onClose, initialFocus, returnFocus }: DialogFocus) => {
  const dialog = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return
    const opener =
      returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    queueMicrotask(() => {
      const initial = initialFocus.current
      const editable = initial?.querySelector<HTMLElement>("[contenteditable='true']")
      ;(editable ?? initial)?.focus()
    })
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        close.current()
        return
      }
      if (event.key !== "Tab" || dialog.current === null) return
      const focusable = Array.from(
        dialog.current.querySelectorAll<HTMLElement>(
          "button, input, textarea, select, [contenteditable='true'], [tabindex]",
        ),
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
  }, [open, initialFocus, returnFocus])
  return dialog
}

export const WorkspaceDialogs = (props: Props) => {
  const createInput = useRef<HTMLInputElement>(null)
  const sharedInput = useRef<HTMLDivElement>(null)
  const createDialog = useDialogFocus({
    open: props.createOpen,
    onClose: props.onCloseCreate,
    initialFocus: createInput,
  })
  const sharedDialog = useDialogFocus({
    open: props.sharedSource !== null,
    onClose: props.onCloseShared,
    initialFocus: sharedInput,
    returnFocus: props.sharedReturnFocus,
  })
  return (
    <>
      {props.createOpen && (
        <div className="structured-dialog-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-page-title"
            aria-describedby="create-page-description"
            className="structured-dialog"
            ref={createDialog}
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
      )}
      {props.sharedSource !== null && (
        <div className="structured-dialog-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="shared-title"
            aria-describedby="shared-description"
            className="structured-dialog"
            ref={sharedDialog}
          >
            <header>
              <h2 id="shared-title">공유 원본 편집</h2>
              <button type="button" aria-label="닫기" onClick={props.onCloseShared}>
                <Cross2Icon />
              </button>
            </header>
            <div ref={sharedInput} tabIndex={-1}>
              <WorkspaceEditor
                workspace={props.workspace}
                document={{
                  pageId: props.sharedSource.id,
                  version: props.sharedSource.version,
                  blocks: props.sharedSource.blocks,
                }}
                depth={0}
                databases={props.databases}
                sources={props.sources}
                onDocument={(document) =>
                  props.onSharedSource({
                    id: document.pageId,
                    version: document.version,
                    blocks: document.blocks.flatMap((block) =>
                      block.type === "paragraph" ||
                      block.type === "heading" ||
                      block.type === "quote" ||
                      block.type === "code"
                        ? [block]
                        : [],
                    ),
                  })
                }
                onSourceEdit={() => {}}
                onOpenPage={() => {}}
                onCompositionChange={props.onCompositionChange}
                autoFocus
              />
            </div>
            <p id="shared-description">이 원본을 참조하는 두 위치가 함께 갱신됩니다.</p>
          </section>
        </div>
      )}
    </>
  )
}

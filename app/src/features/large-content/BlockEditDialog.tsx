import { Cross2Icon } from "@radix-ui/react-icons"
import { useEffect, useRef, useState } from "react"
import { largeContentApi } from "./api"
import { resolveSaveAcknowledgement } from "./editLifecycle"
import type { LargeContentBlock } from "./types"

type BlockEditDialogProps = Readonly<{
  block: LargeContentBlock
  onClose: () => void
  onSaved: (block: LargeContentBlock) => void
  onMove: (index: number, focus: boolean) => void
}>

export const BlockEditDialog = ({ block, onClose, onSaved, onMove }: BlockEditDialogProps) => {
  const [draft, setDraft] = useState(block.text)
  const [status, setStatus] = useState<"idle" | "saving" | "conflict" | "error">("idle")
  const [current, setCurrent] = useState(block)
  const [moveWarning, setMoveWarning] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const draftRef = useRef(draft)
  const targetRef = useRef(block.id)
  const saveRequestRef = useRef(0)
  const mountedRef = useRef(true)
  draftRef.current = draft
  targetRef.current = block.id

  useEffect(
    () => () => {
      mountedRef.current = false
    },
    [],
  )

  useEffect(() => {
    setDraft(block.text)
    setCurrent(block)
    setStatus("idle")
    setMoveWarning(false)
  }, [block])

  const dirty = draft !== current.text
  const requestMove = (index: number) => {
    if (dirty) {
      setMoveWarning(true)
      return
    }
    onMove(index, true)
  }

  const save = async () => {
    const request = saveRequestRef.current + 1
    saveRequestRef.current = request
    const requestTargetId = current.id
    const submittedDraft = draft
    setStatus("saving")
    try {
      const result = await largeContentApi.patch(requestTargetId, current.revision, submittedDraft)
      switch (result.kind) {
        case "updated": {
          onSaved(result.block)
          const outcome = resolveSaveAcknowledgement({
            mounted: mountedRef.current,
            latestRequest: saveRequestRef.current === request,
            requestTargetId,
            currentTargetId: targetRef.current,
            submittedDraft,
            currentDraft: draftRef.current,
          })
          if (outcome === "stale") return
          setCurrent(result.block)
          setStatus("idle")
          if (outcome === "close") onClose()
          return
        }
        case "conflict": {
          onSaved(result.current)
          const outcome = resolveSaveAcknowledgement({
            mounted: mountedRef.current,
            latestRequest: saveRequestRef.current === request,
            requestTargetId,
            currentTargetId: targetRef.current,
            submittedDraft,
            currentDraft: draftRef.current,
          })
          if (outcome === "stale") return
          setCurrent(result.current)
          setStatus("conflict")
          return
        }
        case "missing":
          if (
            !mountedRef.current ||
            saveRequestRef.current !== request ||
            targetRef.current !== requestTargetId
          )
            return
          setStatus("conflict")
          return
      }
    } catch {
      if (
        mountedRef.current &&
        saveRequestRef.current === request &&
        targetRef.current === requestTargetId
      )
        setStatus("error")
    }
  }

  return (
    <div className="large-dialog-scrim" role="presentation">
      <section
        className="large-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="large-edit-title"
        onKeyDown={(event) => {
          if (event.altKey && event.key === "ArrowDown") requestMove(block.index + 1)
          if (event.altKey && event.key === "ArrowUp") requestMove(block.index - 1)
        }}
      >
        <header>
          <div>
            <span className="eyebrow">Edit paragraph</span>
            <h2 id="large-edit-title">Paragraph {block.index + 1}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close editor" onClick={onClose}>
            <Cross2Icon />
          </button>
        </header>
        <p className="large-dialog__meta">
          Version {current.revision} · Your draft is preserved until you save.
        </p>
        <label className="field">
          <span>Paragraph content</span>
          <textarea
            ref={inputRef}
            rows={8}
            value={draft}
            onChange={(event) => {
              draftRef.current = event.target.value
              setDraft(event.target.value)
              setMoveWarning(false)
            }}
            onCompositionStart={() => inputRef.current?.setAttribute("data-composing", "true")}
            onCompositionEnd={() => inputRef.current?.removeAttribute("data-composing")}
          />
        </label>
        {status === "conflict" && (
          <div className="large-conflict" role="alert">
            <strong>This paragraph was updated elsewhere.</strong>
            <p>Your draft is unchanged. Latest content: {current.text}</p>
          </div>
        )}
        {status === "error" && (
          <p className="form-error" role="alert">
            Could not save the paragraph. Your draft is preserved.
          </p>
        )}
        {moveWarning && (
          <p className="form-error" role="alert">
            Save your changes or cancel editing before moving to another paragraph.
          </p>
        )}
        <footer>
          <button className="button button--ghost" type="button" onClick={onClose}>
            Cancel editing
          </button>
          <button
            className="button button--ghost"
            type="button"
            onClick={() => requestMove(block.index - 1)}
            disabled={block.index === 0}
          >
            Previous paragraph
          </button>
          <button
            className="button button--ghost"
            type="button"
            onClick={() => requestMove(block.index + 1)}
          >
            Next paragraph
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={() => void save()}
            disabled={status === "saving" || draft.trim().length === 0}
          >
            {status === "saving" ? "Saving..." : "Save paragraph"}
          </button>
        </footer>
      </section>
    </div>
  )
}

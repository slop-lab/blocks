import { useState } from "react"
import type { ReleaseForm } from "../host/store"
import { DialogFrame } from "./DialogFrame"

type HostFormDialogProps = {
  readonly form: ReleaseForm
  readonly onClose: () => void
  readonly onSave: (draft: Omit<ReleaseForm, "revision">, expectedRevision: number) => boolean
}

export const HostFormDialog = ({ form, onClose, onSave }: HostFormDialogProps) => {
  const [audience, setAudience] = useState(form.audience)
  const [window, setWindow] = useState(form.window)
  const [notes, setNotes] = useState(form.notes)
  const [error, setError] = useState<string | null>(null)

  return (
    <DialogFrame
      titleId="host-form-title"
      eyebrow="HOST-BUFFERED DRAFT"
      title="출시 브리핑 편집"
      onClose={onClose}
    >
      <p className="dialog__description">
        이 초안은 문서 밖의 호스트 상태입니다. 저장 전까지 작업 카드와 본문 버전은 바뀌지 않습니다.
      </p>
      <label className="field">
        <span>대상 사용자</span>
        <input value={audience} onChange={(event) => setAudience(event.target.value)} />
      </label>
      <label className="field">
        <span>배포 창</span>
        <input value={window} onChange={(event) => setWindow(event.target.value)} />
      </label>
      <label className="field">
        <span>호스트 메모</span>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} />
      </label>
      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button className="button button--ghost" type="button" onClick={onClose}>
          초안 취소
        </button>
        <button
          className="button button--primary"
          type="button"
          disabled={audience.trim().length === 0 || window.trim().length === 0}
          onClick={() => {
            const saved = onSave({ audience, window, notes }, form.revision)
            if (saved) onClose()
            else
              setError(
                "호스트 데이터가 외부에서 갱신되었습니다. 창을 닫고 최신 값으로 다시 시도하세요.",
              )
          }}
        >
          호스트에 저장
        </button>
      </footer>
    </DialogFrame>
  )
}

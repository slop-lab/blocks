import type { BlockDocument } from "@slop-lab/blocks"
import { CanonicalBlockEditor } from "./CustomNotesEditor"
import type { LowerDraft } from "./mixed-api"
import { presentationProfile } from "./presentation-profile"

type Props = {
  readonly draft: LowerDraft | null
  readonly pending: boolean
  readonly saving: boolean
  readonly onOpen: (kind: "presentation" | "proposal") => void
  readonly onChange: (document: BlockDocument) => void
  readonly onCancel: () => void
  readonly onSave: () => void
}

export const MixedLowerLayer = ({
  draft,
  pending,
  saving,
  onOpen,
  onChange,
  onCancel,
  onSave,
}: Props) => (
  <aside className="mixed-lower-layer">
    <h3>독립 하위 원본</h3>
    <button
      className="button button--secondary"
      type="button"
      onClick={() => onOpen("presentation")}
    >
      표현 편집
    </button>
    <button className="button button--secondary" type="button" onClick={() => onOpen("proposal")}>
      제안 편집
    </button>
    {draft !== null && (
      <>
        <CanonicalBlockEditor
          key={`${draft.target.layer}-${draft.target.taskId}`}
          document={draft.document}
          onChange={onChange}
          profile={presentationProfile}
          modelId={`mixed-${draft.target.layer}-${draft.target.taskId}`}
          label={
            draft.target.layer === "presentation" ? "혼합 표현 편집기" : "에이전트 제안 편집기"
          }
        />
        <div className="button-row">
          <button
            className="button button--secondary"
            disabled={pending}
            type="button"
            onClick={onCancel}
          >
            {draft.editVersion > 0 ? "변경 취소" : "편집 닫기"}
          </button>
          <button
            className="button button--primary"
            disabled={draft.editVersion === 0 || pending}
            type="button"
            onClick={onSave}
          >
            {saving ? "저장 중" : "하위 문서 저장"}
          </button>
        </div>
      </>
    )}
  </aside>
)

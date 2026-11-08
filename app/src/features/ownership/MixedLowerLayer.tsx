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
    <h3>Independent child source</h3>
    <button
      className="button button--secondary"
      type="button"
      onClick={() => onOpen("presentation")}
    >
      Edit presentation
    </button>
    <button className="button button--secondary" type="button" onClick={() => onOpen("proposal")}>
      Edit proposal
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
            draft.target.layer === "presentation"
              ? "Mixed presentation editor"
              : "Agent proposal editor"
          }
        />
        <div className="button-row">
          <button
            className="button button--secondary"
            disabled={pending}
            type="button"
            onClick={onCancel}
          >
            {draft.editVersion > 0 ? "Discard changes" : "Close editor"}
          </button>
          <button
            className="button button--primary"
            disabled={draft.editVersion === 0 || pending}
            type="button"
            onClick={onSave}
          >
            {saving ? "Saving" : "Save child document"}
          </button>
        </div>
      </>
    )}
  </aside>
)

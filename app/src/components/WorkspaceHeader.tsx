import {
  DownloadIcon,
  EyeOpenIcon,
  FileTextIcon,
  QuestionMarkCircledIcon,
  ResetIcon,
} from "@radix-ui/react-icons"
import type { ContentRoute } from "../host/documents"

const routeLabel: Readonly<Record<ContentRoute, string>> = {
  note: "Local note",
  presentation: "Work briefing",
  readonly: "Read-only guide",
}

type WorkspaceHeaderProps = {
  readonly route: ContentRoute
  readonly dirty: boolean
  readonly preview: boolean
  readonly onSave: () => void
  readonly onTogglePreview: () => void
  readonly onCreateReview: () => void
  readonly onOpenExport: () => void
  readonly onReset: () => void
}

export const WorkspaceHeader = ({
  route,
  dirty,
  preview,
  onSave,
  onTogglePreview,
  onCreateReview,
  onOpenExport,
  onReset,
}: WorkspaceHeaderProps) => (
  <header className="topbar">
    <div>
      <span className="eyebrow">MY DOCUMENTS</span>
      <h1>{routeLabel[route]}</h1>
    </div>
    {
      <div className="topbar__actions">
        <span
          className={
            dirty ? "status-badge status-badge--warning" : "status-badge status-badge--success"
          }
        >
          {dirty ? "Save needed" : "Saved"}
        </span>
        <button className="button button--primary" type="button" onClick={onSave}>
          <FileTextIcon />
          Save
        </button>
        <button className="button button--secondary" type="button" onClick={onTogglePreview}>
          <EyeOpenIcon />
          {preview ? "Editor" : "Static preview"}
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="Create review candidate"
          onClick={onCreateReview}
        >
          <QuestionMarkCircledIcon />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="Import and export"
          onClick={onOpenExport}
        >
          <DownloadIcon />
        </button>
        <button className="icon-button" type="button" aria-label="Reset session" onClick={onReset}>
          <ResetIcon />
        </button>
      </div>
    }
  </header>
)

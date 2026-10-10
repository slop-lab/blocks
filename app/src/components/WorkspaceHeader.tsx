import {
  DownloadIcon,
  EyeOpenIcon,
  FileTextIcon,
  QuestionMarkCircledIcon,
  ResetIcon,
} from "@radix-ui/react-icons"
import type { ContentRoute } from "../host/documents"

const routeLabel: Readonly<Record<ContentRoute, string>> = {
  note: "로컬 노트",
  presentation: "작업 브리핑",
  readonly: "읽기 전용 안내",
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
          {dirty ? "저장 필요" : "저장됨"}
        </span>
        <button className="button button--primary" type="button" onClick={onSave}>
          <FileTextIcon />
          저장
        </button>
        <button className="button button--secondary" type="button" onClick={onTogglePreview}>
          <EyeOpenIcon />
          {preview ? "편집기" : "정적 미리보기"}
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="검토 후보 만들기"
          onClick={onCreateReview}
        >
          <QuestionMarkCircledIcon />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="가져오기와 내보내기"
          onClick={onOpenExport}
        >
          <DownloadIcon />
        </button>
        <button className="icon-button" type="button" aria-label="세션 초기화" onClick={onReset}>
          <ResetIcon />
        </button>
      </div>
    }
  </header>
)

import {
  CheckCircledIcon,
  FileIcon,
  FileTextIcon,
  PersonIcon,
  ReaderIcon,
  RowsIcon,
  TableIcon,
  ViewGridIcon,
} from "@radix-ui/react-icons"

export type RouteId =
  | "note"
  | "presentation"
  | "readonly"
  | "markdown"
  | "collaboration"
  | "composite"
  | "large-content"
  | "workflow"

const routes = [
  { id: "note", label: "A · 로컬 노트", note: "편집 + 저장", icon: FileTextIcon },
  { id: "presentation", label: "B · 작업 브리핑", note: "외부 카드 + 캡션", icon: ViewGridIcon },
  { id: "readonly", label: "C · 읽기 전용", note: "호스트 액션", icon: ReaderIcon },
  { id: "markdown", label: "Markdown 파일", note: "파일 열기 · 편집 · 저장", icon: FileIcon },
  { id: "collaboration", label: "함께 쓰기", note: "실시간 공동 편집", icon: PersonIcon },
  { id: "composite", label: "표와 코드", note: "표 · 캡션 · 코드 편집", icon: TableIcon },
  { id: "large-content", label: "문서 보관함", note: "긴 문서 · 필요한 부분 읽기", icon: RowsIcon },
  { id: "workflow", label: "공유 회의록", note: "작성 · 검토 요청 · 승인", icon: CheckCircledIcon },
] as const

export const Sidebar = ({
  route,
  onNavigate,
}: {
  readonly route: RouteId
  readonly onNavigate: (route: RouteId) => void
}) => (
  <aside className="sidebar" aria-label="예제 탐색">
    <div className="brand">
      <span className="brand__mark">S</span>
      <div>
        <strong>문서 작업실</strong>
        <small>쓰고, 나누고, 정리하기</small>
      </div>
    </div>
    <p className="sidebar__eyebrow">문서</p>
    <nav className="nav-list">
      {routes.map(({ id, label, note, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={route === id ? "nav-row nav-row--active" : "nav-row"}
          onClick={() => onNavigate(id)}
          aria-current={route === id ? "page" : undefined}
        >
          <Icon />
          <span>
            <strong>{label}</strong>
            <small>{note}</small>
          </span>
        </button>
      ))}
    </nav>
  </aside>
)

import {
  CheckCircledIcon,
  FileIcon,
  FileTextIcon,
  PersonIcon,
  ReaderIcon,
  RowsIcon,
  TableIcon,
  TokensIcon,
  ViewGridIcon,
} from "@radix-ui/react-icons"

export type RouteId =
  | "note"
  | "presentation"
  | "readonly"
  | "markdown"
  | "git-documents"
  | "collaboration"
  | "composite"
  | "large-content"
  | "workflow"
  | "ownership"
  | "agent-workbench"
  | "structured-workspace"

const routes = [
  { id: "note", label: "A · Local note", note: "Edit + save", icon: FileTextIcon },
  {
    id: "presentation",
    label: "B · Work briefing",
    note: "External cards + captions",
    icon: ViewGridIcon,
  },
  { id: "readonly", label: "C · Read-only", note: "Host actions", icon: ReaderIcon },
  { id: "markdown", label: "Markdown files", note: "Open · edit · save", icon: FileIcon },
  {
    id: "git-documents",
    label: "Document library",
    note: "Git changes · history · sync",
    icon: FileIcon,
  },
  {
    id: "collaboration",
    label: "Write together",
    note: "Real-time collaboration",
    icon: PersonIcon,
  },
  {
    id: "composite",
    label: "Tables and code",
    note: "Edit tables · captions · code",
    icon: TableIcon,
  },
  {
    id: "large-content",
    label: "Document archive",
    note: "Long documents · load on demand",
    icon: RowsIcon,
  },
  {
    id: "workflow",
    label: "Shared meeting notes",
    note: "Write · request review · approve",
    icon: CheckCircledIcon,
  },
  {
    id: "ownership",
    label: "Ownership examples",
    note: "Five source boundaries",
    icon: ViewGridIcon,
  },
  {
    id: "agent-workbench",
    label: "Agent tools examples",
    note: "Three sources · review · apply",
    icon: TokensIcon,
  },
  {
    id: "structured-workspace",
    label: "Documents and databases",
    note: "Pages · tables · shared blocks",
    icon: TokensIcon,
  },
] as const

export const Sidebar = ({
  route,
  onNavigate,
}: {
  readonly route: RouteId
  readonly onNavigate: (route: RouteId) => void
}) => (
  <aside className="sidebar" aria-label="Example navigation">
    <div className="brand">
      <span className="brand__mark">S</span>
      <div>
        <strong>Document Workshop</strong>
        <small>Write, share, organize</small>
      </div>
    </div>
    <p className="sidebar__eyebrow">Documents</p>
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

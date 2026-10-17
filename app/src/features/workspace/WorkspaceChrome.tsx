import { ResetIcon } from "@radix-ui/react-icons"
import type { Page } from "@slop-lab/blocks-workspace"

export const WorkspaceTopbar = ({
  title,
  status,
}: {
  readonly title: string
  readonly status: string
}) => (
  <header className="structured-topbar">
    <div>
      <span className="eyebrow">문서와 데이터베이스</span>
      <h1>{title}</h1>
    </div>
    <span className="status-badge" role="status">
      {status}
    </span>
  </header>
)

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

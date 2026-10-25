import { ChevronRightIcon, FileIcon } from "@radix-ui/react-icons"
import type { WorkspaceFocus, WorkspaceFocusTarget } from "./workspace-focus-navigation"
import "./workspace-focus-navigation.css"

type Props = {
  readonly focus: WorkspaceFocus
  readonly onNavigate: (target: WorkspaceFocusTarget | null) => void
}

export const WorkspaceFocusBreadcrumbs = ({ focus, onNavigate }: Props) => (
  <nav className="workspace-focus" aria-label="Focus view path">
    <ol>
      {focus.breadcrumbs.map((crumb, index) => {
        const current = index === focus.breadcrumbs.length - 1
        return (
          <li key={crumb.target === null ? "page" : JSON.stringify(crumb.target)}>
            {index > 0 && <ChevronRightIcon aria-hidden="true" />}
            <button
              type="button"
              aria-current={current ? "location" : undefined}
              disabled={current}
              title={crumb.label}
              onClick={() => onNavigate(crumb.target)}
            >
              {index === 0 && <FileIcon aria-hidden="true" />}
              <span>{crumb.label}</span>
            </button>
          </li>
        )
      })}
    </ol>
  </nav>
)

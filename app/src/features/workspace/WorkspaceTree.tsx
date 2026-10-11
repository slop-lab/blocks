import type { Page, Workspace } from "@block-editor/workspace"
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Cross2Icon,
  FileIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  StarIcon,
} from "@radix-ui/react-icons"
import { useEffect, useRef, useState } from "react"

type Props = {
  readonly workspace: Workspace
  readonly activeId: string
  readonly favorites: ReadonlySet<string>
  readonly query: string
  readonly onQuery: (value: string) => void
  readonly onSelect: (id: string) => void
  readonly onCreate: () => void
  readonly onArchive: (id: string) => void
  readonly onFavorite: (id: string) => void
}

const matches = (page: Page, query: string) =>
  page.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())

export const WorkspaceTree = (props: Props) => {
  const [expanded, setExpanded] = useState(false)
  const activeItemRef = useRef<HTMLButtonElement>(null)
  const visible = props.workspace.pages.filter(
    (page) => !page.archived && matches(page, props.query),
  )
  const activeTitle = props.workspace.pages.find((page) => page.id === props.activeId)?.title
  useEffect(() => {
    if (expanded) activeItemRef.current?.scrollIntoView({ block: "nearest" })
  }, [expanded])
  return (
    <aside className="structured-tree" aria-label="페이지 탐색" data-expanded={expanded}>
      <header>
        <strong>Atlas</strong>
        <span className="structured-tree__actions">
          <button
            type="button"
            className="structured-tree__disclosure"
            aria-expanded={expanded}
            aria-controls="structured-page-tree"
            aria-label={`페이지 탐색${activeTitle === undefined ? "" : `, 현재 ${activeTitle}`}`}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </button>
          <button type="button" aria-label="새 페이지" onClick={props.onCreate}>
            <PlusIcon />
          </button>
        </span>
      </header>
      <label className="structured-search">
        <MagnifyingGlassIcon />
        <input
          aria-label="페이지 검색"
          value={props.query}
          onChange={(event) => props.onQuery(event.target.value)}
          placeholder="페이지 검색 · Ctrl K"
        />
        {props.query !== "" && (
          <button type="button" aria-label="검색 지우기" onClick={() => props.onQuery("")}>
            <Cross2Icon />
          </button>
        )}
      </label>
      <nav id="structured-page-tree" aria-label="페이지 트리">
        <ul className="structured-tree__list">
          {visible.map((page) => {
            let depth = 0
            let parent = page.parentId
            while (parent !== null) {
              depth += 1
              parent =
                props.workspace.pages.find((candidate) => candidate.id === parent)?.parentId ?? null
            }
            return (
              <li
                className="structured-tree__row"
                key={page.id}
                style={{ paddingInlineStart: `calc(var(--space-2) + ${depth} * var(--space-4))` }}
              >
                <button
                  type="button"
                  aria-current={page.id === props.activeId ? "page" : undefined}
                  className={page.id === props.activeId ? "is-active" : ""}
                  ref={page.id === props.activeId ? activeItemRef : undefined}
                  onClick={() => props.onSelect(page.id)}
                >
                  <FileIcon /> <span>{page.title}</span>
                </button>
                <button
                  type="button"
                  aria-label={`${page.title} 즐겨찾기`}
                  aria-pressed={props.favorites.has(page.id)}
                  onClick={() => props.onFavorite(page.id)}
                >
                  <StarIcon />
                </button>
                <button
                  type="button"
                  aria-label={`${page.title} 보관`}
                  onClick={() => props.onArchive(page.id)}
                >
                  <ArchiveIcon />
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </aside>
  )
}

import {
  ArchiveIcon,
  CaretSortIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Cross2Icon,
  DragHandleDots2Icon,
  FileIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  StarIcon,
} from "@radix-ui/react-icons"
import type { Page, Workspace } from "@slop-lab/blocks-workspace"
import { type DragEvent, useEffect, useRef, useState } from "react"
import {
  type PagePlacement,
  pageMoveTargets,
  visiblePagePreorder,
} from "./workspace-page-navigation"

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
  readonly onMove: (id: string, placement: PagePlacement) => void
}

const matches = (page: Page, query: string) =>
  page.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())

export const WorkspaceTree = (props: Props) => {
  const [expanded, setExpanded] = useState(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const activeItemRef = useRef<HTMLButtonElement>(null)
  const visible = visiblePagePreorder(props.workspace).filter(({ page }) =>
    matches(page, props.query),
  )
  const activeTitle = props.workspace.pages.find((page) => page.id === props.activeId)?.title
  useEffect(() => {
    if (expanded) activeItemRef.current?.scrollIntoView({ block: "nearest" })
  }, [expanded])
  return (
    <aside className="structured-tree" aria-label="Page navigation" data-expanded={expanded}>
      <header>
        <strong>Atlas</strong>
        <span className="structured-tree__actions">
          <button
            type="button"
            className="structured-tree__disclosure"
            aria-expanded={expanded}
            aria-controls="structured-page-tree"
            aria-label={`Page navigation${activeTitle === undefined ? "" : `, current page: ${activeTitle}`}`}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </button>
          <button type="button" aria-label="New page" onClick={props.onCreate}>
            <PlusIcon />
          </button>
        </span>
      </header>
      <label className="structured-search">
        <MagnifyingGlassIcon />
        <input
          aria-label="Search pages"
          value={props.query}
          onChange={(event) => props.onQuery(event.target.value)}
          placeholder="Search pages · Ctrl K"
        />
        {props.query !== "" && (
          <button type="button" aria-label="Clear search" onClick={() => props.onQuery("")}>
            <Cross2Icon />
          </button>
        )}
      </label>
      <nav id="structured-page-tree" aria-label="Page tree">
        <ul className="structured-tree__list">
          {visible.map(({ page, depth }) => {
            const moveTargets = pageMoveTargets(props.workspace, page.id)
            const placementFromOption = (option: HTMLOptionElement): PagePlacement | null => {
              const targetId = option.dataset["target"]
              switch (option.dataset["kind"]) {
                case "root":
                  return { kind: "root" }
                case "before":
                case "inside":
                case "after":
                  return targetId === undefined ? null : { kind: option.dataset["kind"], targetId }
                default:
                  return null
              }
            }
            const drop = (event: DragEvent<HTMLElement>, placement: PagePlacement) => {
              event.preventDefault()
              const sourceId = event.dataTransfer.getData("text/plain") || draggedId
              if (sourceId !== null && sourceId !== page.id) props.onMove(sourceId, placement)
              setDraggedId(null)
              setDropTarget(null)
            }
            return (
              <li
                className="structured-tree__row"
                key={page.id}
                data-page-id={page.id}
                data-drop-target={dropTarget === page.id ? "true" : undefined}
                style={{ paddingInlineStart: `calc(var(--space-2) + ${depth} * var(--space-4))` }}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = "move"
                  setDropTarget(page.id)
                }}
                onDragLeave={(event) => {
                  if (
                    !(event.relatedTarget instanceof Node) ||
                    !event.currentTarget.contains(event.relatedTarget)
                  )
                    setDropTarget(null)
                }}
                onDrop={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect()
                  const ratio = (event.clientY - bounds.top) / bounds.height
                  const placement: PagePlacement =
                    ratio < 0.25
                      ? { kind: "before", targetId: page.id }
                      : ratio > 0.75
                        ? { kind: "after", targetId: page.id }
                        : { kind: "inside", targetId: page.id }
                  drop(event, placement)
                }}
              >
                <button
                  type="button"
                  className="structured-tree__grip"
                  aria-label={`Drag ${page.title} to move`}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move"
                    event.dataTransfer.setData("text/plain", page.id)
                    setDraggedId(page.id)
                  }}
                  onDragEnd={() => {
                    setDraggedId(null)
                    setDropTarget(null)
                  }}
                >
                  <DragHandleDots2Icon />
                </button>
                <button
                  type="button"
                  aria-current={page.id === props.activeId ? "page" : undefined}
                  className={page.id === props.activeId ? "is-active" : ""}
                  title={page.title}
                  ref={page.id === props.activeId ? activeItemRef : undefined}
                  onClick={() => props.onSelect(page.id)}
                >
                  <FileIcon /> <span>{page.title}</span>
                </button>
                <span className="structured-tree__move-menu">
                  <CaretSortIcon aria-hidden="true" />
                  <select
                    aria-label={`Move ${page.title}`}
                    value=""
                    onChange={(event) => {
                      const option = event.currentTarget.selectedOptions[0]
                      if (option === undefined) return
                      const placement = placementFromOption(option)
                      if (placement !== null) props.onMove(page.id, placement)
                    }}
                  >
                    <option value="">Move</option>
                    <option value="root" data-kind="root">
                      To end of top level
                    </option>
                    {moveTargets.flatMap((target) => [
                      <option
                        value={`before:${target.id}`}
                        data-kind="before"
                        data-target={target.id}
                        key={`before:${target.id}`}
                      >
                        Before {target.title}
                      </option>,
                      <option
                        value={`inside:${target.id}`}
                        data-kind="inside"
                        data-target={target.id}
                        key={`inside:${target.id}`}
                      >
                        Inside {target.title}
                      </option>,
                      <option
                        value={`after:${target.id}`}
                        data-kind="after"
                        data-target={target.id}
                        key={`after:${target.id}`}
                      >
                        After {target.title}
                      </option>,
                    ])}
                  </select>
                </span>
                <button
                  type="button"
                  aria-label={`Favorite ${page.title}`}
                  aria-pressed={props.favorites.has(page.id)}
                  onClick={() => props.onFavorite(page.id)}
                >
                  <StarIcon />
                </button>
                <button
                  type="button"
                  aria-label={`Archive ${page.title}`}
                  onClick={() => props.onArchive(page.id)}
                >
                  <ArchiveIcon />
                </button>
              </li>
            )
          })}
        </ul>
        <button
          type="button"
          className="structured-tree__root-drop"
          data-drop-target={dropTarget === "root" ? "true" : undefined}
          onDragOver={(event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = "move"
            setDropTarget("root")
          }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(event) => {
            event.preventDefault()
            const sourceId = event.dataTransfer.getData("text/plain") || draggedId
            if (sourceId !== null) props.onMove(sourceId, { kind: "root" })
            setDraggedId(null)
            setDropTarget(null)
          }}
        >
          Move to top level
        </button>
      </nav>
    </aside>
  )
}

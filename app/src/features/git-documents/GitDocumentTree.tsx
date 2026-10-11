import { FileIcon, MagnifyingGlassIcon, PlusIcon } from "@radix-ui/react-icons"
import { useState } from "react"
import type { GitDocumentTreeNode, GitSearchResult } from "./git-documents-api"

const Tree = ({
  nodes,
  active,
  onOpen,
}: {
  readonly nodes: readonly GitDocumentTreeNode[]
  readonly active: string | null
  readonly onOpen: (path: string) => void
}) => (
  <ul className="git-docs-tree">
    {nodes.map((node) => (
      <li key={node.path}>
        {node.kind === "directory" ? (
          <details open>
            <summary>{node.name}</summary>
            <Tree nodes={node.children} active={active} onOpen={onOpen} />
          </details>
        ) : (
          <button
            type="button"
            className={
              node.path === active ? "git-docs-file git-docs-file--active" : "git-docs-file"
            }
            onClick={() => onOpen(node.path)}
          >
            <FileIcon />
            <span>{node.name}</span>
          </button>
        )}
      </li>
    ))}
  </ul>
)

export const GitDocumentTree = ({
  tree,
  active,
  results,
  onOpen,
  onCreate,
  onSearch,
}: {
  readonly tree: readonly GitDocumentTreeNode[]
  readonly active: string | null
  readonly results: readonly GitSearchResult[]
  readonly onOpen: (path: string) => void
  readonly onCreate: (path: string) => void
  readonly onSearch: (query: string) => void
}) => {
  const [query, setQuery] = useState("")
  const [navigationOpen, setNavigationOpen] = useState(false)
  return (
    <aside
      className={navigationOpen ? "git-docs-library git-docs-library--open" : "git-docs-library"}
      aria-label="문서 라이브러리"
    >
      <div className="git-docs-library__heading">
        <div>
          <span className="eyebrow">LIBRARY</span>
          <h2>문서 라이브러리</h2>
        </div>
        <div className="git-docs-action-row">
          <button
            type="button"
            className="button button--ghost git-docs-library__toggle"
            aria-expanded={navigationOpen}
            onClick={() => setNavigationOpen((open) => !open)}
          >
            문서 목록
          </button>
          <button
            type="button"
            className="button button--ghost git-docs-icon"
            aria-label="새 Markdown 문서"
            onClick={() => {
              const path = window.prompt("새 문서 경로", "notes/new-note.md")
              if (path !== null) onCreate(path)
            }}
          >
            <PlusIcon />
          </button>
        </div>
      </div>
      <form
        className="git-docs-search"
        onSubmit={(event) => {
          event.preventDefault()
          onSearch(query)
        }}
      >
        <MagnifyingGlassIcon />
        <input
          aria-label="문서 검색"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="전체 문서 검색"
        />
      </form>
      {results.length > 0 && (
        <section className="git-docs-results" aria-label="검색 및 백링크 결과">
          {results.map((result) => (
            <button
              key={`${result.path}:${result.line}`}
              type="button"
              onClick={() => {
                onOpen(result.path)
                setNavigationOpen(false)
              }}
            >
              <strong>{result.path}</strong>
              <small>
                {result.line}행 · {result.excerpt}
              </small>
            </button>
          ))}
        </section>
      )}
      {tree.length === 0 ? (
        <p className="git-docs-empty">아직 문서가 없습니다. 새 문서를 만들어 시작하세요.</p>
      ) : (
        <Tree
          nodes={tree}
          active={active}
          onOpen={(path) => {
            onOpen(path)
            setNavigationOpen(false)
          }}
        />
      )}
    </aside>
  )
}

import { DownloadIcon, FileTextIcon, ReloadIcon } from "@radix-ui/react-icons"
import type { MarkdownFile, MarkdownMapping, MarkdownTreeNode } from "./markdown-api"

type FileListProps = {
  readonly tree: readonly MarkdownTreeNode[]
  readonly activeName: string | null
  readonly dirty: boolean
  readonly onOpen: (name: string) => void
}

const TreeRows = ({
  nodes,
  activeName,
  dirty,
  onOpen,
}: {
  readonly nodes: readonly MarkdownTreeNode[]
  readonly activeName: string | null
  readonly dirty: boolean
  readonly onOpen: (name: string) => void
}) => (
  <>
    {nodes.map((node) =>
      node.kind === "directory" ? (
        <details className="markdown-tree" key={node.path} open>
          <summary className="markdown-tree__directory">{node.name}</summary>
          <TreeRows nodes={node.children} activeName={activeName} dirty={dirty} onOpen={onOpen} />
        </details>
      ) : (
        <button
          className={activeName === node.path ? "nav-row nav-row--active" : "nav-row"}
          type="button"
          key={node.path}
          aria-current={activeName === node.path ? "page" : undefined}
          onClick={() => {
            if (node.path === activeName) return
            if (!dirty || window.confirm("저장하지 않은 초안을 버리고 다른 파일을 여시겠습니까?"))
              onOpen(node.path)
          }}
        >
          <FileTextIcon />
          <span>
            <strong>{node.name}</strong>
            <small>{node.path}</small>
          </span>
        </button>
      ),
    )}
  </>
)

export const MarkdownFileList = ({ tree, activeName, dirty, onOpen }: FileListProps) => (
  <aside className="markdown-files">
    <header>
      <h2>파일</h2>
    </header>
    <nav aria-label="Markdown 파일 목록">
      <TreeRows nodes={tree} activeName={activeName} dirty={dirty} onOpen={onOpen} />
    </nav>
  </aside>
)

type LineMapProps = {
  readonly mappings: readonly MarkdownMapping[]
  readonly selectedId: string | null
  readonly disabled: boolean
  readonly onSelect: (mapping: MarkdownMapping) => void
}

export const MarkdownLineMap = ({ mappings, selectedId, disabled, onSelect }: LineMapProps) => (
  <section aria-label="줄과 객체 매핑">
    <div className="markdown-map__list">
      {mappings.map((mapping) => (
        <button
          type="button"
          key={mapping.id}
          title={mapping.id}
          disabled={disabled}
          className={
            selectedId === mapping.id
              ? "markdown-map__row markdown-map__row--selected"
              : "markdown-map__row"
          }
          onClick={() => onSelect(mapping)}
        >
          <span>{mapping.type}</span>
          <code>
            {mapping.startLine}-{mapping.endLine}
          </code>
        </button>
      ))}
    </div>
  </section>
)

type ConflictProps = {
  readonly disk: MarkdownFile
  readonly onDownload: () => void
  readonly onReload: (disk: MarkdownFile) => void
}

export const MarkdownConflict = ({ disk, onDownload, onReload }: ConflictProps) => (
  <div className="dialog-layer" role="presentation">
    <section
      className="dialog markdown-conflict"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="markdown-conflict-title"
    >
      <h2 id="markdown-conflict-title">디스크 버전과 충돌했습니다</h2>
      <p>
        초안은 그대로 보존했습니다. 최신 디스크 버전을 다시 열거나 초안을 파일로 내려받을 수
        있습니다.
      </p>
      <div className="button-row">
        <button className="button button--secondary" type="button" onClick={onDownload}>
          <DownloadIcon />
          초안 다운로드
        </button>
        <button className="button button--primary" type="button" onClick={() => onReload(disk)}>
          <ReloadIcon />
          디스크 버전 다시 열기
        </button>
      </div>
    </section>
  </div>
)

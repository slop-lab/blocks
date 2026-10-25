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
            if (!dirty || window.confirm("Discard the unsaved draft and open another file?"))
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
      <h2>Files</h2>
    </header>
    <nav aria-label="Markdown file list">
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
  <section aria-label="Line-to-object mapping">
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
      <h2 id="markdown-conflict-title">Conflict with the version on disk</h2>
      <p>
        Your draft is preserved. Reopen the latest version from disk or download the draft as a
        file.
      </p>
      <div className="button-row">
        <button className="button button--secondary" type="button" onClick={onDownload}>
          <DownloadIcon />
          Download draft
        </button>
        <button className="button button--primary" type="button" onClick={() => onReload(disk)}>
          <ReloadIcon />
          Reopen disk version
        </button>
      </div>
    </section>
  </div>
)

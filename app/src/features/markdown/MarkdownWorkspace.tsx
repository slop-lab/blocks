import { CheckIcon, ReloadIcon } from "@radix-ui/react-icons"
import { useRef } from "react"
import { MarkdownRichEditor, type MarkdownRichEditorHandle } from "./MarkdownRichEditor"
import { MarkdownConflict, MarkdownFileList, MarkdownLineMap } from "./MarkdownWorkspaceChrome"
import type { MarkdownMapping } from "./markdown-api"
import { useMarkdownWorkspace } from "./useMarkdownWorkspace"
import "./markdown-workspace.css"
import "./markdown-rich.css"

export const MarkdownWorkspace = ({
  initialFile = null,
}: {
  readonly initialFile?: string | null
}) => {
  const workspace = useMarkdownWorkspace(initialFile)
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const richRef = useRef<MarkdownRichEditorHandle>(null)

  const selectMapping = (mapping: MarkdownMapping) => {
    if (!workspace.mappingFresh) return
    workspace.setSelectedId(mapping.id)
    if (workspace.mode !== "source") return
    const lines = (sourceRef.current?.value ?? workspace.draft).split(/(?<=\n)/u)
    const start = lines.slice(0, mapping.startLine - 1).join("").length
    const end = lines.slice(0, mapping.endLine).join("").length
    sourceRef.current?.focus()
    sourceRef.current?.setSelectionRange(start, end)
  }

  const downloadDraft = () => {
    if (workspace.disk === null) return
    const url = URL.createObjectURL(
      new Blob([workspace.draft], { type: "text/markdown;charset=utf-8" }),
    )
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${workspace.disk.name}.draft.md`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="markdown-workspace" aria-label="Markdown file workspace">
      <MarkdownFileList
        tree={workspace.tree}
        activeName={workspace.disk?.name ?? null}
        dirty={workspace.dirty}
        onOpen={(name) => void workspace.openFile(name)}
      />
      <section className="markdown-main">
        <header className="markdown-header">
          <div>
            <span className="eyebrow">MARKDOWN</span>
            <h1>{workspace.disk?.name ?? "Markdown"}</h1>
          </div>
          <div className="markdown-actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={
                workspace.loading ||
                workspace.saving ||
                workspace.composing ||
                workspace.disk === null
              }
              onClick={() => {
                if (
                  workspace.disk !== null &&
                  (!workspace.dirty ||
                    window.confirm("Discard the draft and reload the file from disk?"))
                )
                  void workspace.openFile(workspace.disk.name, true)
              }}
            >
              <ReloadIcon />
              Reload
            </button>
            <span
              className={
                workspace.dirty
                  ? "status-badge status-badge--warning"
                  : "status-badge status-badge--success"
              }
            >
              {workspace.dirty ? "Unsaved draft" : "Matches disk"}
            </span>
            <label className="markdown-save-mode">
              Save mode
              <select
                value={workspace.saveMode}
                onChange={(event) =>
                  workspace.setSaveMode(event.target.value === "auto" ? "auto" : "manual")
                }
              >
                <option value="manual">Manual</option>
                <option value="auto">Automatic</option>
              </select>
            </label>
            <button
              className="button button--primary"
              type="button"
              disabled={
                !workspace.dirty ||
                workspace.saving ||
                workspace.loading ||
                workspace.composing ||
                workspace.conflict !== null
              }
              onClick={() => void workspace.persist()}
            >
              <CheckIcon />
              {workspace.saving ? "Saving" : "Save"}
            </button>
          </div>
        </header>
        <div className="markdown-tabs" role="tablist" aria-label="Editing mode">
          <button
            type="button"
            role="tab"
            aria-selected={workspace.mode === "visual"}
            disabled={workspace.composing || workspace.loading}
            onClick={() => {
              const current = richRef.current?.source()
              if (current !== workspace.draft) richRef.current?.resetSource(workspace.draft)
              workspace.setMode("visual")
            }}
          >
            Document
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workspace.mode === "source"}
            disabled={workspace.composing || workspace.loading}
            onClick={() => workspace.setMode("source")}
          >
            Markdown source
          </button>
        </div>
        <div className="markdown-editor-pane">
          {workspace.loading || workspace.disk === null ? (
            <p role="status">Loading the file.</p>
          ) : (
            <>
              <MarkdownRichEditor
                key={workspace.disk.name}
                ref={richRef}
                source={workspace.draft}
                hidden={workspace.mode === "source"}
                onChange={workspace.changeDraft}
                onCompositionChange={workspace.onCompositionChange}
                onSave={() => void workspace.persist()}
              />
              {workspace.mode === "source" && (
                <label className="markdown-source">
                  <span>
                    Markdown source
                    <small> Edit unsupported syntax directly in this view.</small>
                  </span>
                  <textarea
                    aria-label="Markdown source"
                    ref={sourceRef}
                    value={workspace.draft}
                    onChange={(event) => workspace.editSource(event.target.value)}
                    onCompositionStart={() => workspace.onCompositionChange(true)}
                    onCompositionEnd={() => workspace.onCompositionChange(false)}
                    onKeyDown={(event) => {
                      if (
                        (event.metaKey || event.ctrlKey) &&
                        event.key.toLocaleLowerCase() === "s"
                      ) {
                        event.preventDefault()
                        void workspace.persist()
                      }
                    }}
                    spellCheck={false}
                  />
                </label>
              )}
            </>
          )}
        </div>
        <footer className="markdown-status" role="status">
          {workspace.status}
        </footer>
      </section>
      <details className="markdown-map">
        <summary>Document location details</summary>
        <MarkdownLineMap
          mappings={workspace.mappings}
          selectedId={workspace.selectedId}
          disabled={!workspace.mappingFresh || workspace.loading}
          onSelect={selectMapping}
        />
      </details>
      {workspace.conflict !== null && (
        <MarkdownConflict
          disk={workspace.conflict}
          onDownload={downloadDraft}
          onReload={workspace.reloadConflict}
        />
      )}
    </section>
  )
}

import { CheckIcon, ReloadIcon } from "@radix-ui/react-icons"
import { useRef } from "react"
import { MarkdownBlockEditor, mappingRange } from "./MarkdownBlockEditor"
import { MarkdownConflict, MarkdownFileList, MarkdownLineMap } from "./MarkdownWorkspaceChrome"
import type { MarkdownMapping } from "./markdown-api"
import { useMarkdownWorkspace } from "./useMarkdownWorkspace"
import "./markdown-workspace.css"

export const MarkdownWorkspace = ({
  initialFile = null,
}: {
  readonly initialFile?: string | null
}) => {
  const workspace = useMarkdownWorkspace(initialFile)
  const sourceRef = useRef<HTMLTextAreaElement>(null)

  const selectMapping = (mapping: MarkdownMapping) => {
    if (!workspace.mappingFresh) return
    workspace.setSelectedId(mapping.id)
    if (workspace.mode === "source") {
      const range = mappingRange(sourceRef.current?.value ?? workspace.draft, mapping)
      sourceRef.current?.focus()
      sourceRef.current?.setSelectionRange(range.start, range.end)
    }
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
    <section className="markdown-workspace" aria-label="Markdown 파일 작업 공간">
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
                    window.confirm("초안을 버리고 디스크 파일을 다시 읽으시겠습니까?"))
                )
                  void workspace.openFile(workspace.disk.name, true)
              }}
            >
              <ReloadIcon />
              다시 읽기
            </button>
            <span
              className={
                workspace.dirty
                  ? "status-badge status-badge--warning"
                  : "status-badge status-badge--success"
              }
            >
              {workspace.dirty ? "저장하지 않은 초안" : "디스크와 동일"}
            </span>
            <label className="markdown-save-mode">
              저장 방식
              <select
                value={workspace.saveMode}
                onChange={(event) =>
                  workspace.setSaveMode(event.target.value === "auto" ? "auto" : "manual")
                }
              >
                <option value="manual">수동</option>
                <option value="auto">자동</option>
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
              {workspace.saving ? "저장 중" : "저장"}
            </button>
          </div>
        </header>
        <div className="markdown-tabs" role="tablist" aria-label="편집 모드">
          <button
            type="button"
            role="tab"
            aria-selected={workspace.mode === "source"}
            disabled={workspace.composing || workspace.loading}
            onClick={() => workspace.setMode("source")}
          >
            원문
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workspace.mode === "blocks"}
            disabled={!workspace.mappingFresh || workspace.composing || workspace.loading}
            onClick={() => workspace.setMode("blocks")}
          >
            블록
          </button>
        </div>
        <div className="markdown-editor-pane">
          {workspace.loading || workspace.disk === null ? (
            <p role="status">파일을 불러오는 중입니다.</p>
          ) : workspace.mode === "source" ? (
            <label className="markdown-source">
              <span>Markdown 원문</span>
              <textarea
                aria-label="Markdown 원문"
                ref={sourceRef}
                value={workspace.draft}
                onChange={(event) => workspace.editSource(event.target.value)}
                onCompositionStart={() => workspace.onCompositionChange(true)}
                onCompositionEnd={() => workspace.onCompositionChange(false)}
                spellCheck={false}
              />
            </label>
          ) : (
            <MarkdownBlockEditor
              content={workspace.draft}
              mappings={workspace.mappings}
              selectedId={workspace.selectedId}
              onSelect={selectMapping}
              onChange={workspace.changeBlock}
              onCompositionChange={workspace.onCompositionChange}
            />
          )}
        </div>
        <footer className="markdown-status" role="status">
          {workspace.status}
        </footer>
      </section>
      <MarkdownLineMap
        mappings={workspace.mappings}
        selectedId={workspace.selectedId}
        disabled={!workspace.mappingFresh || workspace.loading}
        onSelect={selectMapping}
      />
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

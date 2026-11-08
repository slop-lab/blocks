import { CheckIcon, Link2Icon, Pencil2Icon, TrashIcon } from "@radix-ui/react-icons"
import { useRef, useState } from "react"
import { MarkdownRichEditor, type MarkdownRichEditorHandle } from "../markdown/MarkdownRichEditor"
import { GitDocumentTree } from "./GitDocumentTree"
import { GitReviewPanel } from "./GitReviewPanel"
import { useGitDocumentsWorkspace } from "./useGitDocumentsWorkspace"
import "../markdown/markdown-rich.css"
import "./git-documents.css"

export const GitDocumentsWorkspace = () => {
  const workspace = useGitDocumentsWorkspace()
  const [mode, setMode] = useState<"visual" | "source">("visual")
  const editor = useRef<MarkdownRichEditorHandle>(null)
  if (workspace.state === null)
    return (
      <section className="git-docs-unavailable">
        <span className="eyebrow">GIT DOCUMENTS</span>
        <h1>Connect a document library</h1>
        <p>{workspace.status}</p>
        <code>pnpm docs:start -- --repo /path/to/repository --docs docs</code>
      </section>
    )
  return (
    <section className="git-docs-shell" aria-label="Git document workspace">
      <GitDocumentTree
        tree={workspace.state.tree}
        active={workspace.file?.path ?? null}
        results={workspace.results}
        onOpen={(path) => void workspace.open(path)}
        onCreate={workspace.create}
        onSearch={workspace.search}
      />
      <main className="git-docs-editor">
        <header className="git-docs-header">
          <div>
            <span className="eyebrow">
              {workspace.state.repository} / {workspace.state.branch}
            </span>
            <h1>{workspace.file?.path ?? "Create a document"}</h1>
          </div>
          <div className="git-docs-action-row">
            <button
              type="button"
              className="button button--ghost"
              disabled={workspace.file === null}
              onClick={workspace.backlinks}
            >
              <Link2Icon />
              Backlinks
            </button>
            <button
              type="button"
              className="button button--ghost"
              disabled={workspace.file === null}
              onClick={() => {
                if (workspace.file === null) return
                const path = window.prompt("New document path", workspace.file.path)
                if (path !== null && path !== workspace.file.path) workspace.rename(path)
              }}
            >
              <Pencil2Icon />
              Move
            </button>
            <button
              type="button"
              className="button button--ghost"
              disabled={workspace.file === null}
              onClick={() => {
                if (workspace.file !== null && window.confirm(`Delete ${workspace.file.path}?`))
                  workspace.remove()
              }}
            >
              <TrashIcon />
              Delete
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={!workspace.dirty || workspace.busy}
              onClick={workspace.save}
            >
              <CheckIcon />
              Save to working tree
            </button>
          </div>
        </header>
        {workspace.file?.draft !== null && workspace.file?.draft !== undefined && (
          <div className="git-docs-recovery" role="status">
            Recovered an autosaved draft. The Git file has not changed.
            <button type="button" onClick={workspace.discardDraft}>
              Discard draft
            </button>
          </div>
        )}
        <div className="git-docs-tabs" role="tablist" aria-label="Editing mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "visual"}
            onClick={() => {
              editor.current?.resetSource(workspace.draft)
              setMode("visual")
            }}
          >
            Document
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "source"}
            onClick={() => setMode("source")}
          >
            Markdown source
          </button>
        </div>
        <div className="git-docs-paper">
          {workspace.file !== null && (
            <>
              <MarkdownRichEditor
                key={workspace.file.path}
                ref={editor}
                source={workspace.draft}
                hidden={mode === "source"}
                onChange={workspace.setDraft}
                onCompositionChange={() => undefined}
                onSave={workspace.save}
              />
              {mode === "source" && (
                <textarea
                  aria-label="Git Markdown source"
                  value={workspace.draft}
                  onChange={(event) => workspace.setDraft(event.target.value)}
                />
              )}
            </>
          )}
        </div>
        {workspace.state.changes.some(
          (change) => change.conflict && change.path === workspace.file?.path,
        ) && (
          <button
            type="button"
            className="button button--primary git-docs-resolve"
            onClick={workspace.resolve}
          >
            Resolve conflict with current source
          </button>
        )}
        <footer className="git-docs-status" role="status">
          {workspace.status}
        </footer>
      </main>
      <GitReviewPanel
        state={workspace.state}
        diff={workspace.diff}
        history={workspace.history}
        branches={workspace.branches}
        selected={workspace.selected}
        busy={workspace.busy}
        onToggle={workspace.toggleSelected}
        onCommit={workspace.commit}
        onRestore={workspace.restore}
        onCreateBranch={workspace.createBranch}
        onSwitchBranch={workspace.switchBranch}
        onRemote={workspace.remote}
        onCompleteMerge={workspace.completeMerge}
      />
    </section>
  )
}

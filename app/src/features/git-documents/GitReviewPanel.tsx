import { GitHubLogoIcon, ReloadIcon } from "@radix-ui/react-icons"
import { useState } from "react"
import type {
  GitBranch,
  GitDocumentDiff,
  GitDocumentsState,
  GitHistoryEntry,
} from "./git-documents-api"

type PanelTab = "changes" | "history" | "branches"

export const GitReviewPanel = ({
  state,
  diff,
  history,
  branches,
  selected,
  busy,
  onToggle,
  onCommit,
  onRestore,
  onCreateBranch,
  onSwitchBranch,
  onRemote,
  onCompleteMerge,
}: {
  readonly state: GitDocumentsState
  readonly diff: GitDocumentDiff | null
  readonly history: readonly GitHistoryEntry[]
  readonly branches: readonly GitBranch[]
  readonly selected: ReadonlySet<string>
  readonly busy: boolean
  readonly onToggle: (path: string) => void
  readonly onCommit: (message: string) => void
  readonly onRestore: (commit: string) => void
  readonly onCreateBranch: (branch: string) => void
  readonly onSwitchBranch: (branch: string) => void
  readonly onRemote: (action: "fetch" | "fast-forward" | "push" | "merge" | "abort") => void
  readonly onCompleteMerge: (message: string) => void
}) => {
  const [tab, setTab] = useState<PanelTab>("changes")
  const [commitMessage, setCommitMessage] = useState("")
  return (
    <aside className="git-docs-review" aria-label="Change review and history">
      <div className="git-docs-review__tabs" role="tablist" aria-label="Review panel">
        {(["changes", "history", "branches"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {{ changes: "Changes", history: "History", branches: "Branches" }[id]}
          </button>
        ))}
      </div>
      {tab === "changes" && (
        <div className="git-docs-review__body">
          <div className="git-docs-remote">
            <span
              className={`status-badge status-badge--${state.remote.state === "diverged" ? "warning" : "success"}`}
            >
              {state.remote.state} · ↑{state.remote.ahead} ↓{state.remote.behind}
            </span>
            <div className="git-docs-action-row">
              <button type="button" disabled={busy} onClick={() => onRemote("fetch")}>
                <ReloadIcon />
                Fetch
              </button>
              <button
                type="button"
                disabled={busy || state.remote.state !== "behind"}
                onClick={() => onRemote("fast-forward")}
              >
                Fast-forward
              </button>
              <button
                type="button"
                disabled={busy || state.remote.ahead === 0}
                onClick={() => onRemote("push")}
              >
                <GitHubLogoIcon />
                Push
              </button>
            </div>
            {state.remote.state === "diverged" && (
              <button
                type="button"
                className="button button--secondary"
                onClick={() => onRemote("merge")}
              >
                Prepare explicit merge
              </button>
            )}
          </div>
          <div className="git-docs-change-list">
            {state.changes.map((change) => (
              <label
                key={change.path}
                className={
                  change.conflict ? "git-docs-change git-docs-change--conflict" : "git-docs-change"
                }
              >
                <input
                  type="checkbox"
                  checked={selected.has(change.path)}
                  onChange={() => onToggle(change.path)}
                />
                <span>
                  <strong>{change.path}</strong>
                  <small>
                    {change.conflict ? "Conflict" : `${change.staged} / ${change.working}`}
                  </small>
                </span>
              </label>
            ))}
            {state.changes.length === 0 && (
              <p className="git-docs-empty">There are no uncommitted document changes.</p>
            )}
          </div>
          {diff !== null && (
            <details className="git-docs-diff" open>
              <summary>{diff.path} · HEAD and working copy</summary>
              <div>
                <pre>{diff.head ?? "New document"}</pre>
                <pre>{diff.working ?? "Deleted"}</pre>
              </div>
            </details>
          )}
          <label className="git-docs-message">
            Commit message
            <input
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="button button--primary"
            disabled={busy || selected.size === 0 || commitMessage.trim() === ""}
            onClick={() => onCommit(commitMessage)}
          >
            Commit selected documents
          </button>
          {state.changes.some((change) => change.conflict)
            ? null
            : state.remote.state === "diverged" && (
                <button
                  type="button"
                  className="button button--primary"
                  disabled={commitMessage.trim() === ""}
                  onClick={() => onCompleteMerge(commitMessage)}
                >
                  Complete merge commit
                </button>
              )}
        </div>
      )}
      {tab === "history" && (
        <div className="git-docs-review__body git-docs-history">
          {history.map((entry) => (
            <article key={entry.commit}>
              <strong>{entry.subject}</strong>
              <small>
                {entry.author} · {new Date(entry.authoredAt).toLocaleString()}
              </small>
              <button type="button" onClick={() => onRestore(entry.commit)}>
                Restore to working copy
              </button>
            </article>
          ))}
          {history.length === 0 && (
            <p className="git-docs-empty">This document has no commit history.</p>
          )}
        </div>
      )}
      {tab === "branches" && (
        <div className="git-docs-review__body git-docs-history">
          {branches.map((branch) => (
            <article key={branch.name}>
              <strong>{branch.name}</strong>
              <small>
                {branch.current
                  ? "Current branch"
                  : branch.managed
                    ? "Managed worktree"
                    : "Repository branch"}
              </small>
              {!branch.current && (
                <button type="button" onClick={() => onSwitchBranch(branch.name)}>
                  Open this branch
                </button>
              )}
            </article>
          ))}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              const branch = window.prompt("New branch name", "notes/topic")
              if (branch !== null) onCreateBranch(branch)
            }}
          >
            New branch
          </button>
        </div>
      )}
    </aside>
  )
}

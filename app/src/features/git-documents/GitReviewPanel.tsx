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
    <aside className="git-docs-review" aria-label="변경 검토와 기록">
      <div className="git-docs-review__tabs" role="tablist" aria-label="검토 패널">
        {(["changes", "history", "branches"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {{ changes: "변경", history: "기록", branches: "브랜치" }[id]}
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
                가져오기
              </button>
              <button
                type="button"
                disabled={busy || state.remote.state !== "behind"}
                onClick={() => onRemote("fast-forward")}
              >
                빠른 반영
              </button>
              <button
                type="button"
                disabled={busy || state.remote.ahead === 0}
                onClick={() => onRemote("push")}
              >
                <GitHubLogoIcon />
                보내기
              </button>
            </div>
            {state.remote.state === "diverged" && (
              <button
                type="button"
                className="button button--secondary"
                onClick={() => onRemote("merge")}
              >
                명시적으로 병합 준비
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
                  <small>{change.conflict ? "충돌" : `${change.staged} / ${change.working}`}</small>
                </span>
              </label>
            ))}
            {state.changes.length === 0 && (
              <p className="git-docs-empty">커밋하지 않은 문서 변경이 없습니다.</p>
            )}
          </div>
          {diff !== null && (
            <details className="git-docs-diff" open>
              <summary>{diff.path} · HEAD와 작업본</summary>
              <div>
                <pre>{diff.head ?? "새 문서"}</pre>
                <pre>{diff.working ?? "삭제됨"}</pre>
              </div>
            </details>
          )}
          <label className="git-docs-message">
            커밋 메시지
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
            선택한 문서 커밋
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
                  병합 커밋 완료
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
                작업본으로 복원
              </button>
            </article>
          ))}
          {history.length === 0 && (
            <p className="git-docs-empty">이 문서의 커밋 기록이 없습니다.</p>
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
                  ? "현재 브랜치"
                  : branch.managed
                    ? "관리 작업 트리"
                    : "저장소 브랜치"}
              </small>
              {!branch.current && (
                <button type="button" onClick={() => onSwitchBranch(branch.name)}>
                  이 브랜치 열기
                </button>
              )}
            </article>
          ))}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              const branch = window.prompt("새 브랜치 이름", "notes/topic")
              if (branch !== null) onCreateBranch(branch)
            }}
          >
            새 브랜치
          </button>
        </div>
      )}
    </aside>
  )
}

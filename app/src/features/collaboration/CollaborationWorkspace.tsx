import { FontBoldIcon, FontItalicIcon, ResetIcon } from "@radix-ui/react-icons"
import type { EditorView } from "prosemirror-view"
import { useEffect, useState } from "react"
import { redo, undo } from "y-prosemirror"
import type { BlockDocument } from "../../core/types"
import { toggleFormat } from "../../pm/commands"
import { CollaborationBinding, type CollaborationStatus } from "./CollaborationBinding"
import { CollaborationEditor } from "./CollaborationEditor"
import "./collaboration.css"

const statusLabel: Readonly<Record<CollaborationStatus, string>> = {
  offline: "오프라인",
  connecting: "연결 중",
  connected: "연결됨",
  reconnecting: "재연결 중",
  incompatible: "스키마 불일치",
}

const cssColor = (token: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(token).trim()

const text = (value: string) => [{ kind: "text" as const, text: value, marks: [] }]

const collaborationSeed: BlockDocument = {
  format: "block-editor/v0.3",
  blocks: [
    {
      id: "collaboration-title",
      type: "heading",
      attrs: { level: 1 },
      content: text("공동 편집 회의록"),
    },
    {
      id: "collaboration-agenda",
      type: "paragraph",
      attrs: {},
      content: text("다음 모임의 주제를 정합니다."),
    },
    {
      id: "collaboration-preparation",
      type: "paragraph",
      attrs: {},
      content: text("준비물을 함께 정리합니다."),
    },
    {
      id: "collaboration-locked-policy",
      type: "paragraph",
      attrs: {},
      content: text("사진: 동의 후 공유합니다."),
      locked: true,
    },
  ],
}

const useBindingState = (binding: CollaborationBinding) => {
  const [status, setStatus] = useState(binding.connectionStatus)
  const [hasConnected, setHasConnected] = useState(binding.connectionStatus === "connected")
  const [users, setUsers] = useState(binding.users)
  useEffect(() => {
    const unsubscribeStatus = binding.subscribeStatus((nextStatus) => {
      setStatus(nextStatus)
      if (nextStatus === "connected") setHasConnected(true)
    })
    const unsubscribePresence = binding.subscribePresence(() => setUsers(binding.users))
    return () => {
      unsubscribeStatus()
      unsubscribePresence()
    }
  }, [binding])
  return { status, users, hasConnected }
}

type PeerPanelProps = {
  readonly label: string
  readonly binding: CollaborationBinding
  readonly onActive: (view: EditorView, label: string) => void
}

const PeerPanel = ({ label, binding, onActive }: PeerPanelProps) => {
  const { status, users, hasConnected } = useBindingState(binding)
  const online = status === "connected" || status === "connecting" || status === "reconnecting"
  return (
    <section className="collaboration-peer" aria-labelledby={`collaboration-${label}`}>
      <header className="collaboration-peer__header">
        <div>
          <span className="eyebrow">함께 쓰는 문서</span>
          <h2 id={`collaboration-${label}`}>{label}</h2>
        </div>
        <span
          className={
            status === "connected"
              ? "status-badge status-badge--success"
              : status === "incompatible"
                ? "status-badge status-badge--warning"
                : "status-badge"
          }
        >
          {statusLabel[status]}
        </span>
      </header>
      <ul className="collaboration-peer__presence" aria-label={`${label} 참여자`}>
        {users.map((user) => (
          <li className="collaboration-person" key={`${user.name}-${user.color}`}>
            <span className="collaboration-person__dot" style={{ backgroundColor: user.color }} />
            {user.name}
          </li>
        ))}
      </ul>
      {status === "incompatible" && (
        <p className="collaboration-error" role="alert">
          서버와 편집기 스키마 버전이 달라 연결을 중단했습니다.
        </p>
      )}
      {hasConnected ? (
        <CollaborationEditor
          label={label}
          binding={binding}
          onActive={(view) => onActive(view, label)}
        />
      ) : (
        <div className="collaboration-editor collaboration-editor--loading" role="status">
          권위 있는 공동 문서를 동기화하고 있습니다.
        </div>
      )}
      <button
        className="button button--secondary collaboration-peer__connection"
        type="button"
        onClick={() => (online ? binding.disconnect() : binding.connect())}
        disabled={status === "incompatible"}
      >
        {online ? "오프라인으로 전환" : "다시 연결"}
      </button>
    </section>
  )
}

export const CollaborationWorkspace = () => {
  const [bindings, setBindings] = useState<
    readonly [CollaborationBinding, CollaborationBinding] | null
  >(null)
  const [active, setActive] = useState<{
    readonly view: EditorView
    readonly label: string
  } | null>(null)

  useEffect(() => {
    const room = new URLSearchParams(location.search).get("collaborationRoom") ?? "slate-demo"
    const nextBindings = [
      new CollaborationBinding({
        room,
        user: { name: "민서", color: cssColor("--accent") },
        initialDocument: collaborationSeed,
      }),
      new CollaborationBinding({
        room,
        user: { name: "지우", color: cssColor("--locked") },
        initialDocument: collaborationSeed,
      }),
    ] as const
    setBindings(nextBindings)
    for (const binding of nextBindings) binding.connect()
    return () => {
      setActive(null)
      for (const binding of nextBindings) binding.destroy()
    }
  }, [])

  const run = (command: (view: EditorView) => boolean) => {
    if (active === null) return
    command(active.view)
    active.view.focus()
  }

  return (
    <section className="collaboration-workspace" aria-label="실시간 공동 편집">
      <header className="collaboration-intro">
        <div>
          <span className="eyebrow">함께 쓰기</span>
          <h1>한 문서, 두 개의 독립된 선택</h1>
          <p>
            각 편집기는 자체 선택과 로컬 실행 취소 기록을 가지며, 문서 변경과 현재 위치는
            WebSocket으로 공유됩니다.
          </p>
        </div>
        <p className="collaboration-intro__note">
          표시 이름은 현재 위치를 설명하기 위한 정보이며 접근 권한을 부여하지 않습니다.
        </p>
      </header>
      <div
        className="collaboration-toolbar toolbar"
        role="toolbar"
        aria-label="활성 공동 편집기 도구"
      >
        <strong>{active === null ? "편집기를 선택하세요" : `${active.label} 활성`}</strong>
        <span className="toolbar__divider" />
        <button
          className="tool"
          type="button"
          aria-label="실행 취소"
          onClick={() => run((view) => undo(view.state))}
          disabled={active === null}
        >
          <ResetIcon />
        </button>
        <button
          className="tool"
          type="button"
          aria-label="다시 실행"
          onClick={() => run((view) => redo(view.state))}
          disabled={active === null}
        >
          <ResetIcon className="flip" />
        </button>
        <button
          className="tool"
          type="button"
          aria-label="굵게"
          onClick={() => run((view) => toggleFormat("strong")(view.state, view.dispatch, view))}
          disabled={active === null}
        >
          <FontBoldIcon />
        </button>
        <button
          className="tool"
          type="button"
          aria-label="기울임"
          onClick={() => run((view) => toggleFormat("em")(view.state, view.dispatch, view))}
          disabled={active === null}
        >
          <FontItalicIcon />
        </button>
      </div>
      {bindings === null ? (
        <div className="collaboration-editor collaboration-editor--loading" role="status">
          공동 편집 연결을 준비하고 있습니다.
        </div>
      ) : (
        <div className="collaboration-grid">
          <PeerPanel
            label="편집자 A"
            binding={bindings[0]}
            onActive={(view, label) => setActive({ view, label })}
          />
          <PeerPanel
            label="편집자 B"
            binding={bindings[1]}
            onActive={(view, label) => setActive({ view, label })}
          />
        </div>
      )}
    </section>
  )
}

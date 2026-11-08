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
  offline: "Offline",
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  incompatible: "Schema mismatch",
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
      content: text("Collaborative meeting notes"),
    },
    {
      id: "collaboration-agenda",
      type: "paragraph",
      attrs: {},
      content: text("Choose a topic for the next meeting."),
    },
    {
      id: "collaboration-preparation",
      type: "paragraph",
      attrs: {},
      content: text("Organize the materials together."),
    },
    {
      id: "collaboration-locked-policy",
      type: "paragraph",
      attrs: {},
      content: text("Photos: share only with consent."),
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
          <span className="eyebrow">Shared document</span>
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
      <ul className="collaboration-peer__presence" aria-label={`${label} participants`}>
        {users.map((user) => (
          <li className="collaboration-person" key={`${user.name}-${user.color}`}>
            <span className="collaboration-person__dot" style={{ backgroundColor: user.color }} />
            {user.name}
          </li>
        ))}
      </ul>
      {status === "incompatible" && (
        <p className="collaboration-error" role="alert">
          The server and editor schema versions differ, so the connection was stopped.
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
          Synchronizing the authoritative shared document.
        </div>
      )}
      <button
        className="button button--secondary collaboration-peer__connection"
        type="button"
        onClick={() => (online ? binding.disconnect() : binding.connect())}
        disabled={status === "incompatible"}
      >
        {online ? "Go offline" : "Reconnect"}
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
        user: { name: "Minseo", color: cssColor("--accent") },
        initialDocument: collaborationSeed,
      }),
      new CollaborationBinding({
        room,
        user: { name: "Jiwoo", color: cssColor("--locked") },
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
    <section className="collaboration-workspace" aria-label="Real-time collaborative editing">
      <header className="collaboration-intro">
        <div>
          <span className="eyebrow">Collaborative editing</span>
          <h1>One document, two independent selections</h1>
          <p>
            Each editor has its own selection and local undo history, while document changes and
            presence are shared over WebSocket.
          </p>
        </div>
        <p className="collaboration-intro__note">
          Display names describe presence and do not grant access.
        </p>
      </header>
      <div
        className="collaboration-toolbar toolbar"
        role="toolbar"
        aria-label="Active collaborative editor tools"
      >
        <strong>{active === null ? "Select an editor" : `${active.label} active`}</strong>
        <span className="toolbar__divider" />
        <button
          className="tool"
          type="button"
          aria-label="Undo"
          onClick={() => run((view) => undo(view.state))}
          disabled={active === null}
        >
          <ResetIcon />
        </button>
        <button
          className="tool"
          type="button"
          aria-label="Redo"
          onClick={() => run((view) => redo(view.state))}
          disabled={active === null}
        >
          <ResetIcon className="flip" />
        </button>
        <button
          className="tool"
          type="button"
          aria-label="Bold"
          onClick={() => run((view) => toggleFormat("strong")(view.state, view.dispatch, view))}
          disabled={active === null}
        >
          <FontBoldIcon />
        </button>
        <button
          className="tool"
          type="button"
          aria-label="Italic"
          onClick={() => run((view) => toggleFormat("em")(view.state, view.dispatch, view))}
          disabled={active === null}
        >
          <FontItalicIcon />
        </button>
      </div>
      {bindings === null ? (
        <div className="collaboration-editor collaboration-editor--loading" role="status">
          Preparing the collaborative editing connection.
        </div>
      ) : (
        <div className="collaboration-grid">
          <PeerPanel
            label="Editor A"
            binding={bindings[0]}
            onActive={(view, label) => setActive({ view, label })}
          />
          <PeerPanel
            label="Editor B"
            binding={bindings[1]}
            onActive={(view, label) => setActive({ view, label })}
          />
        </div>
      )}
    </section>
  )
}

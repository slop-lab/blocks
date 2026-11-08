import {
  ArrowDownIcon,
  ArrowUpIcon,
  CodeIcon,
  CopyIcon,
  FontBoldIcon,
  FontItalicIcon,
  HeadingIcon,
  PlusIcon,
  QuoteIcon,
  ResetIcon,
  TrashIcon,
} from "@radix-ui/react-icons"
import { redo, undo } from "prosemirror-history"
import type { EditorView } from "prosemirror-view"
import type { ReactNode } from "react"
import { useState } from "react"
import {
  deleteBlock,
  duplicateBlock,
  insertBlock,
  moveBlock,
  setType,
  toggleFormat,
} from "../pm/commands"
import { editorSchema } from "../pm/schema"

type ToolProps = {
  readonly label: string
  readonly children: ReactNode
  readonly action: () => void
  readonly disabled?: boolean
}

const Tool = ({ label, children, action, disabled = false }: ToolProps) => (
  <button
    className="tool"
    type="button"
    aria-label={label}
    title={label}
    onClick={action}
    disabled={disabled}
  >
    {children}
  </button>
)

export const Toolbar = ({
  view,
  readOnly,
}: {
  readonly view: EditorView | null
  readonly readOnly: boolean
}) => {
  const [feedback, setFeedback] = useState("")
  const run =
    (
      command: Parameters<EditorView["dispatch"]>[0] extends never
        ? never
        : (
            state: EditorView["state"],
            dispatch?: EditorView["dispatch"],
            view?: EditorView,
          ) => boolean,
    ) =>
    () => {
      if (view !== null) {
        const handled = command(view.state, view.dispatch, view)
        setFeedback(
          handled ? "" : "This action is unavailable here, or there is nothing to change.",
        )
      }
      view?.focus()
    }
  return (
    <div className="toolbar" role="toolbar" aria-label="Document editing tools">
      <Tool label="Undo" action={run(undo)} disabled={readOnly || view === null}>
        <ResetIcon />
      </Tool>
      <Tool label="Redo" action={run(redo)} disabled={readOnly || view === null}>
        <ResetIcon className="flip" />
      </Tool>
      <span className="toolbar__divider" />
      <Tool label="Bold" action={run(toggleFormat("strong"))} disabled={readOnly}>
        <FontBoldIcon />
      </Tool>
      <Tool label="Italic" action={run(toggleFormat("em"))} disabled={readOnly}>
        <FontItalicIcon />
      </Tool>
      <Tool label="Heading" action={run(setType("heading", { level: 2 }))} disabled={readOnly}>
        <HeadingIcon />
      </Tool>
      <Tool label="Quote" action={run(setType("blockquote"))} disabled={readOnly}>
        <QuoteIcon />
      </Tool>
      <Tool label="Code" action={run(setType("code_block"))} disabled={readOnly}>
        <CodeIcon />
      </Tool>
      <span className="toolbar__divider" />
      <Tool
        label="Add paragraph"
        action={run(insertBlock(editorSchema.nodes["paragraph"]))}
        disabled={readOnly}
      >
        <PlusIcon />
      </Tool>
      <Tool label="Duplicate block" action={run(duplicateBlock)} disabled={readOnly}>
        <CopyIcon />
      </Tool>
      <Tool label="Move block up" action={run(moveBlock(-1))} disabled={readOnly}>
        <ArrowUpIcon />
      </Tool>
      <Tool label="Move block down" action={run(moveBlock(1))} disabled={readOnly}>
        <ArrowDownIcon />
      </Tool>
      <Tool label="Delete block" action={run(deleteBlock)} disabled={readOnly}>
        <TrashIcon />
      </Tool>
      {readOnly && <span className="status-badge">Read-only</span>}
      {feedback && (
        <span role="status" className="muted">
          {feedback}
        </span>
      )}
    </div>
  )
}

import { redo as codeRedo, undo as codeUndo, selectAll } from "@codemirror/commands"
import type { EditorView as CodeView } from "@codemirror/view"
import { CodeIcon, ResetIcon, RowsIcon, TableIcon, TrashIcon } from "@radix-ui/react-icons"
import { redo, undo } from "prosemirror-history"
import type { Command } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import type { ReactNode } from "react"
import { tableCommands } from "./profile"

export type CompositeContext = "prose" | "code"

type CompositeToolbarProps = {
  readonly activeContext: CompositeContext
  readonly proseView: EditorView | null
  readonly codeView: CodeView | null
  readonly onStatus: (message: string) => void
}

const Tool = ({
  label,
  disabled,
  onRun,
  children,
}: {
  readonly label: string
  readonly disabled: boolean
  readonly onRun: () => void
  readonly children: ReactNode
}) => (
  <button
    className="tool"
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onRun}
  >
    {children}
  </button>
)

export const CompositeToolbar = ({
  activeContext,
  proseView,
  codeView,
  onStatus,
}: CompositeToolbarProps) => {
  const runProse = (command: Command, label: string) => () => {
    if (proseView === null) return
    const handled = command(proseView.state, proseView.dispatch, proseView)
    onStatus(
      handled ? `${label} applied.` : "This action is unavailable for the current selection.",
    )
    proseView.focus()
  }
  const runCode = (command: (target: CodeView) => boolean, label: string) => () => {
    if (codeView === null) return
    const handled = command(codeView)
    onStatus(
      handled
        ? `${label} applied to the code.`
        : "There are no changes to apply to the code history.",
    )
    codeView.focus()
  }
  const proseActive = activeContext === "prose"
  return (
    <div className="toolbar composite-toolbar" role="toolbar" aria-label="Active editor tools">
      <span className="status-badge">{proseActive ? "Document tools" : "Code tools"}</span>
      <Tool
        label="Undo in active editor"
        disabled={proseActive ? proseView === null : codeView === null}
        onRun={proseActive ? runProse(undo, "Undo") : runCode(codeUndo, "Undo")}
      >
        <ResetIcon />
      </Tool>
      <Tool
        label="Redo in active editor"
        disabled={proseActive ? proseView === null : codeView === null}
        onRun={proseActive ? runProse(redo, "Redo") : runCode(codeRedo, "Redo")}
      >
        <ResetIcon className="flip" />
      </Tool>
      {proseActive ? (
        <>
          <span className="toolbar__divider" />
          <Tool
            label="Add row below"
            disabled={proseView === null}
            onRun={runProse(tableCommands.addRowAfter, "Add row")}
          >
            <RowsIcon />
          </Tool>
          <Tool
            label="Add column to the right"
            disabled={proseView === null}
            onRun={runProse(tableCommands.addColumnAfter, "Add column")}
          >
            <TableIcon />
          </Tool>
          <Tool
            label="Merge selected cells"
            disabled={proseView === null}
            onRun={runProse(tableCommands.mergeCells, "Merge cells")}
          >
            <TableIcon />
          </Tool>
          <Tool
            label="Split merged cell"
            disabled={proseView === null}
            onRun={runProse(tableCommands.splitCell, "Split cell")}
          >
            <TableIcon />
          </Tool>
          <Tool
            label="Delete selected row"
            disabled={proseView === null}
            onRun={runProse(tableCommands.deleteRow, "Delete row")}
          >
            <TrashIcon />
          </Tool>
          <Tool
            label="Delete selected column"
            disabled={proseView === null}
            onRun={runProse(tableCommands.deleteColumn, "Delete column")}
          >
            <TrashIcon />
          </Tool>
        </>
      ) : (
        <>
          <span className="toolbar__divider" />
          <Tool
            label="Select all code"
            disabled={codeView === null}
            onRun={runCode(selectAll, "Select all")}
          >
            <CodeIcon />
          </Tool>
        </>
      )}
    </div>
  )
}

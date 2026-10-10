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
      handled ? `${label} 작업을 적용했습니다.` : "현재 선택에서는 이 작업을 사용할 수 없습니다.",
    )
    proseView.focus()
  }
  const runCode = (command: (target: CodeView) => boolean, label: string) => () => {
    if (codeView === null) return
    const handled = command(codeView)
    onStatus(
      handled ? `${label} 작업을 코드에 적용했습니다.` : "코드 기록에 적용할 변경이 없습니다.",
    )
    codeView.focus()
  }
  const proseActive = activeContext === "prose"
  return (
    <div className="toolbar composite-toolbar" role="toolbar" aria-label="활성 편집 영역 도구">
      <span className="status-badge">{proseActive ? "문서 도구" : "코드 도구"}</span>
      <Tool
        label="활성 영역 실행 취소"
        disabled={proseActive ? proseView === null : codeView === null}
        onRun={proseActive ? runProse(undo, "실행 취소") : runCode(codeUndo, "실행 취소")}
      >
        <ResetIcon />
      </Tool>
      <Tool
        label="활성 영역 다시 실행"
        disabled={proseActive ? proseView === null : codeView === null}
        onRun={proseActive ? runProse(redo, "다시 실행") : runCode(codeRedo, "다시 실행")}
      >
        <ResetIcon className="flip" />
      </Tool>
      {proseActive ? (
        <>
          <span className="toolbar__divider" />
          <Tool
            label="아래 행 추가"
            disabled={proseView === null}
            onRun={runProse(tableCommands.addRowAfter, "행 추가")}
          >
            <RowsIcon />
          </Tool>
          <Tool
            label="오른쪽 열 추가"
            disabled={proseView === null}
            onRun={runProse(tableCommands.addColumnAfter, "열 추가")}
          >
            <TableIcon />
          </Tool>
          <Tool
            label="선택 셀 병합"
            disabled={proseView === null}
            onRun={runProse(tableCommands.mergeCells, "셀 병합")}
          >
            <TableIcon />
          </Tool>
          <Tool
            label="병합 셀 분할"
            disabled={proseView === null}
            onRun={runProse(tableCommands.splitCell, "셀 분할")}
          >
            <TableIcon />
          </Tool>
          <Tool
            label="선택 행 삭제"
            disabled={proseView === null}
            onRun={runProse(tableCommands.deleteRow, "행 삭제")}
          >
            <TrashIcon />
          </Tool>
          <Tool
            label="선택 열 삭제"
            disabled={proseView === null}
            onRun={runProse(tableCommands.deleteColumn, "열 삭제")}
          >
            <TrashIcon />
          </Tool>
        </>
      ) : (
        <>
          <span className="toolbar__divider" />
          <Tool
            label="코드 전체 선택"
            disabled={codeView === null}
            onRun={runCode(selectAll, "전체 선택")}
          >
            <CodeIcon />
          </Tool>
        </>
      )}
    </div>
  )
}

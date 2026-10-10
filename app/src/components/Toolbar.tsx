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
        setFeedback(handled ? "" : "선택한 위치에서 사용할 수 없거나 실행할 변경이 없습니다.")
      }
      view?.focus()
    }
  return (
    <div className="toolbar" role="toolbar" aria-label="문서 편집 도구">
      <Tool label="실행 취소" action={run(undo)} disabled={readOnly || view === null}>
        <ResetIcon />
      </Tool>
      <Tool label="다시 실행" action={run(redo)} disabled={readOnly || view === null}>
        <ResetIcon className="flip" />
      </Tool>
      <span className="toolbar__divider" />
      <Tool label="굵게" action={run(toggleFormat("strong"))} disabled={readOnly}>
        <FontBoldIcon />
      </Tool>
      <Tool label="기울임" action={run(toggleFormat("em"))} disabled={readOnly}>
        <FontItalicIcon />
      </Tool>
      <Tool label="제목" action={run(setType("heading", { level: 2 }))} disabled={readOnly}>
        <HeadingIcon />
      </Tool>
      <Tool label="인용" action={run(setType("blockquote"))} disabled={readOnly}>
        <QuoteIcon />
      </Tool>
      <Tool label="코드" action={run(setType("code_block"))} disabled={readOnly}>
        <CodeIcon />
      </Tool>
      <span className="toolbar__divider" />
      <Tool
        label="문단 추가"
        action={run(insertBlock(editorSchema.nodes["paragraph"]))}
        disabled={readOnly}
      >
        <PlusIcon />
      </Tool>
      <Tool label="블록 복제" action={run(duplicateBlock)} disabled={readOnly}>
        <CopyIcon />
      </Tool>
      <Tool label="블록 위로 이동" action={run(moveBlock(-1))} disabled={readOnly}>
        <ArrowUpIcon />
      </Tool>
      <Tool label="블록 아래로 이동" action={run(moveBlock(1))} disabled={readOnly}>
        <ArrowDownIcon />
      </Tool>
      <Tool label="블록 삭제" action={run(deleteBlock)} disabled={readOnly}>
        <TrashIcon />
      </Tool>
      {readOnly && <span className="status-badge">읽기 전용</span>}
      {feedback && (
        <span role="status" className="muted">
          {feedback}
        </span>
      )}
    </div>
  )
}

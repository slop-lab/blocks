import type { BlockDocument } from "../core/types"
import type { HostTask } from "../host/store"
import { BlockViewer } from "../Viewer"

export const StaticViewer = ({
  document,
  tasks = {},
  onHostAction,
}: {
  readonly document: BlockDocument
  readonly tasks?: Readonly<Record<string, HostTask>>
  readonly onHostAction?: (taskId: string) => void
}) => (
  <section aria-label="Static document preview">
    <BlockViewer
      content={document}
      renderBlock={(block) => {
        if (block.type !== "task_card") return undefined
        const taskId = String(block.attrs["taskId"] ?? "")
        const task = tasks[taskId]
        return (
          <section className="task-card">
            <span className="task-card__meta">
              {taskId} · {task?.status ?? "unavailable"}
            </span>
            <strong>{task?.title ?? "Host data unavailable"}</strong>
            <button
              className="button button--secondary"
              type="button"
              disabled={task === undefined || onHostAction === undefined}
              onClick={() => onHostAction?.(taskId)}
            >
              {task?.status === "done" ? "Reopen" : "Mark complete"}
            </button>
          </section>
        )
      }}
    />
  </section>
)

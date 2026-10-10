import { z } from "zod"
import type { BlockDocument, SurfaceState } from "../core/types"

const taskStatusSchema = z.union([
  z.literal("open"),
  z.literal("review"),
  z.literal("waiting"),
  z.literal("done"),
])
const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: taskStatusSchema,
})
const releaseFormSchema = z.object({
  audience: z.string(),
  window: z.string(),
  notes: z.string(),
  revision: z.number().int().nonnegative(),
})
const hostStateSchema = z.object({
  tasks: z.record(z.string(), taskSchema),
  releaseForm: releaseFormSchema,
})

export type TaskStatus = z.infer<typeof taskStatusSchema>
export type HostTask = z.infer<typeof taskSchema>
export type ReleaseForm = z.infer<typeof releaseFormSchema>
export type HostState = z.infer<typeof hostStateSchema>

const initialHostState: HostState = {
  tasks: {
    "TASK-142": { id: "TASK-142", title: "작업실 대관", status: "open" },
    "TASK-153": { id: "TASK-153", title: "참가 안내 발송", status: "review" },
    "TASK-201": { id: "TASK-201", title: "워크숍 일정 확정", status: "waiting" },
  },
  releaseForm: {
    audience: "동네 창작자와 이웃",
    window: "금요일 14:00–16:00",
    notes: "장소를 확정한 뒤 참가자에게 안내합니다.",
    revision: 1,
  },
}

export const createHostState = (): HostState => structuredClone(initialHostState)

export const loadHostState = (storage: Storage): HostState => {
  const stored = storage.getItem("slate-foundation-host")
  if (stored === null) return createHostState()
  try {
    const parsed = hostStateSchema.safeParse(JSON.parse(stored))
    return parsed.success ? parsed.data : createHostState()
  } catch (error) {
    if (error instanceof SyntaxError) return createHostState()
    throw error
  }
}

export const saveHostState = (storage: Storage, state: HostState): void => {
  storage.setItem("slate-foundation-host", JSON.stringify(state))
}

export const toggleTask = (state: HostState, taskId: string): HostState => {
  const task = state.tasks[taskId]
  if (task === undefined) return state
  return {
    ...state,
    tasks: {
      ...state.tasks,
      [taskId]: { ...task, status: task.status === "done" ? "open" : "done" },
    },
  }
}

export const saveReleaseForm = (
  state: HostState,
  draft: Omit<ReleaseForm, "revision">,
): HostState => ({
  ...state,
  releaseForm: { ...draft, revision: state.releaseForm.revision + 1 },
})

export const sanitizeHostDocument = (document: BlockDocument): BlockDocument => ({
  ...document,
  blocks: document.blocks.map((block) => {
    if (block.type !== "task_card") return block
    const { title: _title, status: _status, ...presentation } = block.attrs
    return { ...block, attrs: presentation }
  }),
})

export const createViewData = (): SurfaceState => ({
  ui: { selectedBlockId: null, inspectorOpen: true },
  overlays: { channel: "content", composing: false },
})

import ky from "ky"
import { z } from "zod"

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["backlog", "running", "done"]),
  version: z.number().int().positive(),
})
const proposalSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  draft: z.string(),
  dependencyVersion: z.number().int().positive(),
})
const stateSchema = z.object({
  revision: z.number().int().positive(),
  tasks: z.array(taskSchema),
  presentation: z.record(z.string(), z.string()),
  proposals: z.array(proposalSchema),
  taskInfoFile: z.string(),
})

export type MixedState = z.infer<typeof stateSchema>
export type MixedTask = z.infer<typeof taskSchema>

export const loadMixed = async (): Promise<MixedState> =>
  stateSchema.parse(await ky.get("/api/ownership/mixed").json())

export const changeTaskStatus = async (state: MixedState, task: MixedTask): Promise<MixedState> =>
  stateSchema.parse(
    await ky
      .post("/api/ownership/mixed/task-status", {
        json: {
          expectedRevision: state.revision,
          taskId: task.id,
          status: task.status === "running" ? "done" : "running",
        },
      })
      .json(),
  )

export const savePresentation = async (
  state: MixedState,
  taskId: string,
  caption: string,
): Promise<MixedState> =>
  stateSchema.parse(
    await ky
      .post("/api/ownership/mixed/presentation", {
        json: { expectedRevision: state.revision, taskId, caption },
      })
      .json(),
  )

export const saveProposal = async (
  state: MixedState,
  proposalId: string,
  draft: string,
): Promise<MixedState> => {
  const proposal = state.proposals.find((item) => item.id === proposalId)
  if (proposal === undefined) throw new TypeError("Proposal is missing")
  return stateSchema.parse(
    await ky
      .post("/api/ownership/mixed/proposal", {
        json: {
          expectedRevision: state.revision,
          id: proposal.id,
          taskId: proposal.taskId,
          draft,
          dependencyVersion: proposal.dependencyVersion,
        },
      })
      .json(),
  )
}

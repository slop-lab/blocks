import type { BlockDocument } from "@block-editor/model"
import ky from "ky"
import { z } from "zod"

const inlineSchema = z
  .object({ kind: z.literal("text"), text: z.string(), marks: z.array(z.unknown()) })
  .strict()
const blockSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    attrs: z.record(z.string(), z.unknown()),
    content: z.array(inlineSchema),
  })
  .strict()
const documentSchema = z
  .object({ format: z.literal("block-editor/v0.3"), blocks: z.array(blockSchema) })
  .strict()
const taskSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.enum(["backlog", "running", "done"]),
    version: z.number().int().positive(),
  })
  .strict()
const proposalSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    document: documentSchema,
    dependencyVersion: z.number().int().positive(),
  })
  .strict()
const stateSchema = z
  .object({
    revision: z.number().int().positive(),
    tasks: z.array(taskSchema),
    presentations: z.record(z.string(), documentSchema),
    proposals: z.array(proposalSchema),
    taskInfoFiles: z.record(z.string(), z.string()),
  })
  .strict()
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
  document: BlockDocument,
): Promise<MixedState> =>
  stateSchema.parse(
    await ky
      .post("/api/ownership/mixed/presentation", {
        json: { expectedRevision: state.revision, taskId, document },
      })
      .json(),
  )
export const saveProposal = async (
  state: MixedState,
  proposalId: string,
  document: BlockDocument,
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
          document,
          dependencyVersion: proposal.dependencyVersion,
        },
      })
      .json(),
  )
}

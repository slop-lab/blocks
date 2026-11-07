import { z } from "zod"

const inlineSchema = z
  .object({
    kind: z.literal("text"),
    text: z.string().max(20_000),
    marks: z.array(z.unknown()).max(100),
  })
  .strict()
const blockSchema = z
  .object({
    id: z.string().min(1).max(200),
    type: z.string().min(1).max(100),
    attrs: z.record(z.string(), z.unknown()),
    content: z.array(inlineSchema).max(200),
  })
  .strict()
const documentSchema = z
  .object({ format: z.literal("block-editor/v0.3"), blocks: z.array(blockSchema).min(1).max(200) })
  .strict()
const taskSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    status: z.enum(["backlog", "running", "done"]),
    version: z.number().int().positive(),
  })
  .strict()
const proposalSchema = z
  .object({
    id: z.string().min(1),
    taskId: z.string().min(1),
    document: documentSchema,
    dependencyVersion: z.number().int().positive(),
  })
  .strict()
export const mixedSchema = z
  .object({
    schemaVersion: z.literal(2),
    tasks: z.array(taskSchema),
    presentations: z.record(z.string(), documentSchema),
    proposals: z.array(proposalSchema),
    taskInfoFiles: z.record(z.string(), z.string()),
  })
  .strict()
const legacyDocumentSchema = z.union([documentSchema, z.string()])
const legacyMixedSchema = z
  .object({
    schemaVersion: z.literal(1).optional(),
    tasks: z.array(taskSchema),
    presentations: z.record(z.string(), legacyDocumentSchema),
    proposals: z.array(
      z
        .object({
          id: z.string(),
          taskId: z.string(),
          document: legacyDocumentSchema,
          dependencyVersion: z.number().int().positive(),
        })
        .strict(),
    ),
    taskInfoFiles: z.record(z.string(), z.string()),
  })
  .strict()
export const revisionSchema = z.object({ expectedRevision: z.number().int().positive() }).strict()
export const statusSchema = revisionSchema
  .extend({ taskId: z.string(), status: z.enum(["backlog", "running", "done"]) })
  .strict()
export const documentInputSchema = revisionSchema
  .extend({ taskId: z.string(), document: documentSchema })
  .strict()
export const proposalInputSchema = documentInputSchema
  .extend({ id: z.string(), dependencyVersion: z.number().int().positive() })
  .strict()

const text = (id, value) => ({
  id,
  type: "ownership.caption",
  attrs: {},
  content: [{ kind: "text", text: value, marks: [] }],
})
export const initial = {
  schemaVersion: 2,
  tasks: [
    { id: "TASK-104", title: "Summarize customer interviews", status: "running", version: 1 },
    { id: "TASK-108", title: "Sort search results", status: "backlog", version: 1 },
  ],
  presentations: {
    "TASK-104": {
      format: "block-editor/v0.3",
      blocks: [text("caption-104", "In progress this week")],
    },
    "TASK-108": {
      format: "block-editor/v0.3",
      blocks: [text("caption-108", "Next up for review")],
    },
  },
  proposals: [
    {
      id: "proposal-1",
      taskId: "TASK-104",
      document: {
        format: "block-editor/v0.3",
        blocks: [text("proposal-text-1", "Summarize the interview findings in two paragraphs")],
      },
      dependencyVersion: 1,
    },
  ],
  taskInfoFiles: { "TASK-104": "tasks/TASK-104.md", "TASK-108": "tasks/TASK-108.md" },
}
const documentFromLegacy = (id, value) =>
  typeof value === "string" ? { format: "block-editor/v0.3", blocks: [text(id, value)] } : value
export const migrateMixedContent = (input) => {
  const current = mixedSchema.safeParse(input)
  if (current.success) return { migrated: false, content: current.data }
  const legacy = legacyMixedSchema.parse(input)
  return {
    migrated: true,
    content: {
      schemaVersion: 2,
      tasks: legacy.tasks,
      presentations: Object.fromEntries(
        Object.entries(legacy.presentations).map(([taskId, value]) => [
          taskId,
          documentFromLegacy(`caption-${taskId}`, value),
        ]),
      ),
      proposals: legacy.proposals.map((proposal) => ({
        ...proposal,
        document: documentFromLegacy(`proposal-${proposal.id}`, proposal.document),
      })),
      taskInfoFiles: legacy.taskInfoFiles,
    },
  }
}

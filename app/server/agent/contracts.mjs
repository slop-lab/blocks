import { z } from "zod"

const textInlineSchema = z.object({
  kind: z.literal("text"),
  text: z.string().max(20_000),
  marks: z.array(z.unknown()).max(100),
})

const blockSchema = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(200),
    type: z.string().min(1).max(100),
    attrs: z.record(z.string(), z.unknown()),
    content: z.array(textInlineSchema).max(200),
    children: z.array(blockSchema).max(200).optional(),
    locked: z.boolean().optional(),
  }),
)

const documentSchema = z.object({
  format: z.literal("block-editor/v0.3"),
  blocks: z.array(blockSchema).max(200),
})

const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/)

export const agentArtifactSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("markdown-replacement"),
    file: z.string().min(1).max(500),
    revision: fingerprintSchema,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    before: z.string().max(2_000_000),
    after: z.string().max(2_000_000),
    fingerprint: fingerprintSchema,
  }),
  z.object({
    kind: z.literal("workspace-row-status"),
    databaseId: z.string().min(1).max(200),
    revision: z.number().int().positive(),
    rowId: z.string().min(1).max(200),
    propertyId: z.string().min(1).max(200),
    before: z.string().min(1).max(200),
    after: z.string().min(1).max(200),
    fingerprint: fingerprintSchema,
  }),
  z.object({
    kind: z.literal("mixed-task-plan"),
    taskId: z.string().min(1).max(200),
    repositoryRevision: z.number().int().positive(),
    dependencyVersion: z.number().int().positive(),
    evidence: z.array(z.object({ name: z.string().min(1).max(500), revision: fingerprintSchema })),
    before: documentSchema.nullable(),
    after: documentSchema,
    fingerprint: fingerprintSchema,
  }),
])

export const agentRunInputSchema = z.object({
  kind: z.enum(["proposal", "task"]),
  requestId: z.string().min(1).max(200),
  sessionId: z.string().min(1).max(200),
  instruction: z.string().trim().min(1).max(20_000),
  inferenceModel: z.string().trim().min(1).max(200).optional(),
  target: z.object({
    modelId: z.string().min(1).max(200),
    epoch: z.number().int().nonnegative(),
    baseVersion: z.number().int().nonnegative(),
    taskId: z.string().min(1).max(200).optional(),
    dependencyVersion: z.number().int().positive().optional(),
    resourceId: z.string().min(1).max(500).optional(),
  }),
  document: documentSchema,
})

const eventSchema = z.object({
  id: z.number().int().positive(),
  type: z.string(),
  at: z.string(),
  detail: z.string(),
})

export const agentRunRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  owner: z.object({ subject: z.string(), authority: z.string() }),
  input: agentRunInputSchema,
  inputHash: z.string().length(64).nullable().default(null),
  provider: z.enum(["fixture", "remote"]),
  providerLabel: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled", "interrupted"]),
  cancellation: z.enum(["not-requested", "requested", "confirmed", "partial"]),
  candidate: agentRunInputSchema.shape.document.nullable(),
  artifact: agentArtifactSchema.nullable().default(null),
  authority: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("client-draft") }),
    z.object({ kind: z.literal("markdown"), resourceId: z.string(), revision: z.string() }),
    z.object({ kind: z.literal("workspace"), resourceId: z.string(), revision: z.number() }),
    z.object({
      kind: z.literal("mixed-backlog"),
      resourceId: z.string(),
      revision: z.number(),
      dependencyVersion: z.number(),
    }),
  ]),
  application: z.enum(["not-requested", "applying", "applied", "conflict"]),
  applicationResult: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("applied"), revision: z.union([z.string(), z.number()]) }),
      z.object({
        kind: z.literal("conflict"),
        actualRevision: z.union([z.string(), z.number()]),
      }),
    ])
    .nullable()
    .default(null),
  commandReceipts: z
    .array(
      z.object({
        commandId: z.string().min(1).max(200),
        action: z.enum(["cancel", "apply"]),
        inputHash: z.string().length(64),
        result: z.json(),
      }),
    )
    .max(100)
    .default([]),
  operation: z.object({ owner: z.string(), kind: z.string(), id: z.string() }).nullable(),
  events: z.array(eventSchema).max(100),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const agentJournalSchema = z.object({
  schemaVersion: z.literal(1),
  runs: z.array(agentRunRecordSchema),
})

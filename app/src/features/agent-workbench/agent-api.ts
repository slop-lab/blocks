import ky from "ky"
import { z } from "zod"

const artifactSchema = z
  .object({ kind: z.string(), fingerprint: z.string(), before: z.unknown(), after: z.unknown() })
  .passthrough()
const eventSchema = z.object({
  id: z.number(),
  type: z.string(),
  at: z.string(),
  detail: z.string(),
})
const runSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled", "interrupted"]),
  providerLabel: z.string(),
  artifact: artifactSchema.nullable(),
  events: z.array(eventSchema),
  application: z.enum(["not-requested", "applying", "applied", "conflict"]),
  applicationResult: z.unknown().nullable(),
  error: z.string().nullable(),
})
const operationSchema = z.object({ owner: z.string(), kind: z.string(), id: z.string() })
const receiptSchema = z.object({ kind: z.literal("accepted"), operation: operationSchema })
const querySchema = z.object({ ok: z.literal(true), value: z.unknown() })

export type AgentRun = z.infer<typeof runSchema>
export type AgentOperation = z.infer<typeof operationSchema>

const post = (path: string, json: unknown) =>
  ky.post(`/api/agent/${path}`, { json, retry: 0, timeout: 10_000 }).json()

export const queryAgent = async (queryId: string, target?: AgentOperation) => {
  const payload = querySchema.parse(
    await post("queries", { queryId, version: 1, input: null, target }),
  )
  return payload.value
}

export const startAgent = async (input: {
  readonly instruction: string
  readonly target: Readonly<Record<string, string | number>>
}) => {
  const session = z
    .object({ sessionId: z.string() })
    .parse(await queryAgent("block-editor.agent/session"))
  const receipt = receiptSchema.parse(
    await post("commands", {
      protocolVersion: 1,
      commandId: crypto.randomUUID(),
      actionId: "block-editor.agent/start",
      actionVersion: 1,
      input: {
        kind: "proposal",
        requestId: crypto.randomUUID(),
        sessionId: session.sessionId,
        instruction: input.instruction,
        target: input.target,
        document: { format: "block-editor/v0.3", blocks: [] },
      },
    }),
  )
  return receipt.operation
}

export const getAgentRun = async (operation: AgentOperation) =>
  runSchema.parse(await queryAgent("block-editor.agent/get", operation))

export const commandAgent = async (operation: AgentOperation, action: "apply" | "cancel") =>
  post("commands", {
    protocolVersion: 1,
    commandId: crypto.randomUUID(),
    actionId: `block-editor.agent/${action}`,
    actionVersion: 1,
    target: operation,
    input: action === "cancel" ? "user-request" : null,
  })

export const loadAgentResources = async () => {
  const [markdown, workspace, mixed] = await Promise.all([
    ky.get("/api/markdown", { retry: 0 }).json(),
    ky.get("/api/workspace", { retry: 0 }).json(),
    ky.get("/api/ownership/mixed", { retry: 0 }).json(),
  ])
  return {
    markdown: z.object({ files: z.array(z.string()) }).parse(markdown).files,
    databases: z
      .object({
        databases: z.array(
          z.object({
            documentId: z.string(),
            revision: z.number(),
            content: z.object({ name: z.string() }),
          }),
        ),
      })
      .parse(workspace).databases,
    tasks: z
      .object({
        revision: z.number(),
        tasks: z.array(
          z.object({ id: z.string(), title: z.string(), status: z.string(), version: z.number() }),
        ),
      })
      .parse(mixed),
  }
}

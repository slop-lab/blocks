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
const modelCatalogSchema = z.object({
  models: z.array(z.object({ id: z.string(), providerLabel: z.string() })),
  defaultModel: z.string().nullable(),
})
const markdownResourcesSchema = z.object({ files: z.array(z.string()) })
const workspaceResourcesSchema = z.object({
  databases: z.array(
    z.object({
      documentId: z.string(),
      revision: z.number(),
      content: z.object({ name: z.string() }),
    }),
  ),
})
const mixedResourcesSchema = z.object({
  revision: z.number(),
  tasks: z.array(
    z.object({ id: z.string(), title: z.string(), status: z.string(), version: z.number() }),
  ),
})

type ResourceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

export type AgentRun = z.infer<typeof runSchema>
export type AgentOperation = z.infer<typeof operationSchema>
export type AgentModelCatalog = z.infer<typeof modelCatalogSchema>
export type AgentResourceErrors = Partial<Record<"markdown" | "workspace" | "mixed", string>>

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
  readonly inferenceModel?: string
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
        ...(input.inferenceModel === undefined ? {} : { inferenceModel: input.inferenceModel }),
      },
    }),
  )
  return receipt.operation
}

export const loadAgentModels = async (): Promise<AgentModelCatalog> =>
  modelCatalogSchema.parse(await ky.get("/api/agent/models", { retry: 0, timeout: 10_000 }).json())

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

const loadResource = async <T>(path: string, schema: z.ZodType<T>): Promise<ResourceResult<T>> => {
  try {
    return { ok: true, value: schema.parse(await ky.get(path, { retry: 0 }).json()) }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "알 수 없는 리소스 오류",
    }
  }
}

export const loadAgentResources = async () => {
  const [markdown, workspace, mixed] = await Promise.all([
    loadResource("/api/markdown", markdownResourcesSchema),
    loadResource("/api/workspace", workspaceResourcesSchema),
    loadResource("/api/ownership/mixed", mixedResourcesSchema),
  ])
  return {
    markdown: markdown.ok ? markdown.value.files : [],
    databases: workspace.ok ? workspace.value.databases : [],
    tasks: mixed.ok ? mixed.value : null,
    errors: {
      ...(markdown.ok ? {} : { markdown: markdown.error }),
      ...(workspace.ok ? {} : { workspace: workspace.error }),
      ...(mixed.ok ? {} : { mixed: mixed.error }),
    } satisfies AgentResourceErrors,
  }
}

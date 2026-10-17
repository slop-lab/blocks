import { createBudget, defineTool, toolContext } from "@block-editor/agent-tools"
import { bindPartTool } from "@block-editor/agent-tools-part"
import { z } from "zod"
import { sealArtifact } from "./artifacts.mjs"

const emptySchema = z.object({}).strict()
const documentSchema = z.object({
  format: z.literal("block-editor/v0.3"),
  blocks: z.array(z.unknown()).max(200),
})
const artifactOutputSchema = z
  .object({ kind: z.string(), fingerprint: z.string().length(64) })
  .passthrough()

const executionContext = ({ input, owner, operationId, signal, targetIsCurrent }) =>
  toolContext({
    principal: owner,
    sessionId: input.sessionId,
    modelEpoch: input.target.epoch,
    expectedRevision: input.target.baseVersion,
    operationId,
    signal,
    budget: createBudget({ calls: 8, bytes: 128_000, items: 400, depth: 16, durationMs: 60_000 }),
    authorize: async (effect) => effect !== "write",
    targetIsCurrent,
  })

const bind = (tool, context) => bindPartTool(tool, () => context)
const success = (execution, value, resources, usage = { items: 1, depth: 1 }) => ({
  kind: "success",
  value,
  provenance: execution.provenance({ resources }),
  usage,
})

const markdownTools = (options, context) => {
  const file = options.authoritative.context.file
  const search = defineTool({
    id: "search_documents",
    description: "Search the bounded managed Markdown inventory",
    effect: "read",
    input: z.object({ query: z.string().max(500) }).strict(),
    output: z.array(z.object({ file: z.string(), revision: z.string() })).max(20),
    prepare: async (_input, execution) =>
      success(execution, [{ file: file.name, revision: file.revision }], ["markdown:inventory"]),
  })
  const read = defineTool({
    id: "read_markdown_range",
    description: "Read an exact line range from a managed Markdown file",
    effect: "read",
    input: z
      .object({
        file: z.string(),
        startLine: z.number().int().positive(),
        endLine: z.number().int().positive(),
      })
      .strict(),
    output: z.object({
      file: z.string(),
      revision: z.string(),
      startLine: z.number(),
      endLine: z.number(),
      text: z.string(),
    }),
    prepare: async ({ startLine, endLine }, execution) => {
      const lines = file.content.match(/.*(?:\r\n|\n|$)/g)?.filter(Boolean) ?? []
      const boundedEnd = Math.min(endLine, Math.max(lines.length, 1))
      return success(
        execution,
        {
          file: file.name,
          revision: file.revision,
          startLine,
          endLine: boundedEnd,
          text: lines.slice(startLine - 1, boundedEnd).join(""),
        },
        [`markdown:${file.name}@${file.revision}`],
      )
    },
  })
  const propose = defineTool({
    id: "propose_markdown_replacement",
    description: "Create an exact reviewed replacement without writing the file",
    effect: "propose",
    input: z.object({ append: z.string().min(1).max(20_000) }).strict(),
    output: artifactOutputSchema,
    prepare: async ({ append }, execution) => {
      const lines = file.content.match(/.*(?:\r\n|\n|$)/g)?.filter(Boolean) ?? []
      const separator = file.content.endsWith("\r\n") ? "" : file.content.endsWith("\n") ? "" : "\n"
      const newline = file.content.includes("\r\n") ? "\r\n" : "\n"
      const artifact = sealArtifact({
        kind: "markdown-replacement",
        file: file.name,
        revision: file.revision,
        startLine: 1,
        endLine: Math.max(lines.length, 1),
        before: file.content,
        after: `${file.content}${separator}${append}${newline}`,
      })
      return {
        ...success(execution, artifact, [`artifact:${artifact.fingerprint}`]),
        commit: async () => options.writeArtifact(artifact),
      }
    },
  })
  return [search, read, propose].map((tool) => bind(tool, context))
}

const workspaceTools = (options, context) => {
  const { database, revision } = options.authoritative.context
  const query = defineTool({
    id: "query_database_rows",
    description: "Read bounded rows and typed properties from the canonical database",
    effect: "read",
    input: emptySchema,
    output: z.object({
      databaseId: z.string(),
      revision: z.number(),
      properties: z.array(z.unknown()),
      rows: z.array(z.unknown()),
    }),
    prepare: async (_input, execution) =>
      success(
        execution,
        { databaseId: database.id, revision, properties: database.properties, rows: database.rows },
        [`workspace-database:${database.id}@${revision}`],
        { items: database.rows.length, depth: 2 },
      ),
  })
  const propose = defineTool({
    id: "propose_row_status_patch",
    description: "Create an exact typed status-cell patch without mutating the database",
    effect: "propose",
    input: z.object({ rowId: z.string(), propertyId: z.string(), after: z.string() }).strict(),
    output: artifactOutputSchema,
    prepare: async ({ rowId, propertyId, after }, execution) => {
      const property = database.properties.find((item) => item.id === propertyId)
      if (property?.type !== "status") throw new RangeError("Status property is unavailable")
      if (!property.options.includes(after)) throw new RangeError("Status option is unavailable")
      const row = database.rows.find((item) => item.id === rowId)
      const before = row?.values[propertyId]
      if (typeof before !== "string") throw new RangeError("Status cell is unavailable")
      const artifact = sealArtifact({
        kind: "workspace-row-status",
        databaseId: database.id,
        revision,
        rowId,
        propertyId,
        before,
        after,
      })
      return {
        ...success(execution, artifact, [`artifact:${artifact.fingerprint}`]),
        commit: async () => options.writeArtifact(artifact),
      }
    },
  })
  return [query, propose].map((tool) => bind(tool, context))
}

const mixedTools = (options, context) => {
  const { content, task, current, linked } = options.authoritative.context
  const running = defineTool({
    id: "list_running_tasks",
    description: "List running tasks from the canonical mixed backlog",
    effect: "read",
    input: emptySchema,
    output: z.array(
      z.object({ id: z.string(), title: z.string(), status: z.string(), version: z.number() }),
    ),
    prepare: async (_input, execution) =>
      success(
        execution,
        content.tasks.filter((item) => item.status === "running"),
        [`mixed-backlog@${options.authoritative.authority.revision}`],
      ),
  })
  const taskContext = defineTool({
    id: "read_task_context",
    description: "Read the selected task and its existing reviewed proposal",
    effect: "read",
    input: emptySchema,
    output: z.object({ task: z.unknown(), current: documentSchema.nullable() }),
    prepare: async (_input, execution) =>
      success(execution, { task, current }, [`task:${task.id}@${task.version}`]),
  })
  const evidence = defineTool({
    id: "read_linked_evidence",
    description: "Read the actual linked Markdown evidence and content hash",
    effect: "read",
    input: emptySchema,
    output: z.object({ name: z.string(), revision: z.string(), content: z.string() }).nullable(),
    prepare: async (_input, execution) =>
      success(
        execution,
        linked === null
          ? null
          : { name: linked.name, revision: linked.revision, content: linked.content },
        linked === null ? [] : [`markdown:${linked.name}@${linked.revision}`],
      ),
  })
  const propose = defineTool({
    id: "propose_task_plan",
    description: "Create an evidence-bound task plan without mutating the backlog",
    effect: "propose",
    input: z.object({ text: z.string().min(1).max(20_000) }).strict(),
    output: artifactOutputSchema,
    prepare: async ({ text }, execution) => {
      const after = {
        format: "block-editor/v0.3",
        blocks: [
          {
            id: `agent-plan-${task.id}`,
            type: "ownership.caption",
            attrs: {},
            content: [{ kind: "text", text, marks: [] }],
          },
        ],
      }
      const artifact = sealArtifact({
        kind: "mixed-task-plan",
        taskId: task.id,
        repositoryRevision: options.authoritative.authority.revision,
        dependencyVersion: task.version,
        evidence: linked === null ? [] : [{ name: linked.name, revision: linked.revision }],
        before: current,
        after,
      })
      return {
        ...success(execution, artifact, [`artifact:${artifact.fingerprint}`]),
        commit: async () => options.writeArtifact(artifact),
      }
    },
  })
  return [running, taskContext, evidence, propose].map((tool) => bind(tool, context))
}

const clientTools = (options, context) => {
  const patch = defineTool({
    id: "candidate_patch",
    description: "Append a paragraph to a client-only review candidate",
    effect: "propose",
    input: z.object({ text: z.string().min(1).max(20_000) }).strict(),
    output: documentSchema,
    prepare: async ({ text }, execution) => {
      const current = options.candidate()
      const next = {
        ...current,
        blocks: [
          ...current.blocks,
          {
            id: crypto.randomUUID(),
            type: current.blocks[0]?.type ?? "paragraph",
            attrs: {},
            content: [{ kind: "text", text, marks: [] }],
          },
        ],
      }
      return {
        ...success(execution, next, ["client-review-draft"], {
          items: next.blocks.length,
          depth: 1,
        }),
        commit: async () => options.writeCandidate(next),
      }
    },
  })
  return [bind(patch, context)]
}

export const createDocumentTools = (options) => {
  const context = executionContext(options)
  switch (options.authoritative.context.kind) {
    case "markdown":
      return markdownTools(options, context)
    case "workspace":
      return workspaceTools(options, context)
    case "mixed-backlog":
      return mixedTools(options, context)
    case "client-draft":
      return clientTools(options, context)
    default:
      throw new TypeError("Unsupported authoritative context")
  }
}

const schema = (value) => z.toJSONSchema(value, { io: "input", unrepresentable: "throw" })
export const documentToolSchemas = {
  search_documents: schema(z.object({ query: z.string().max(500) }).strict()),
  read_markdown_range: schema(
    z
      .object({
        file: z.string(),
        startLine: z.number().int().positive(),
        endLine: z.number().int().positive(),
      })
      .strict(),
  ),
  propose_markdown_replacement: schema(
    z.object({ append: z.string().min(1).max(20_000) }).strict(),
  ),
  query_database_rows: schema(emptySchema),
  propose_row_status_patch: schema(
    z.object({ rowId: z.string(), propertyId: z.string(), after: z.string() }).strict(),
  ),
  list_running_tasks: schema(emptySchema),
  read_task_context: schema(emptySchema),
  read_linked_evidence: schema(emptySchema),
  propose_task_plan: schema(z.object({ text: z.string().min(1).max(20_000) }).strict()),
  candidate_patch: schema(z.object({ text: z.string().min(1).max(20_000) }).strict()),
}

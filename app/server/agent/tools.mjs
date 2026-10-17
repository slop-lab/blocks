import { createBudget, defineTool, toolContext } from "@block-editor/agent-tools"
import { bindPartTool } from "@block-editor/agent-tools-part"
import { z } from "zod"

const emptySchema = z.object({}).strict()
const patchSchema = z.object({ text: z.string().min(1).max(20_000) }).strict()
const documentSchema = z.object({
  format: z.literal("block-editor/v0.3"),
  blocks: z.array(z.unknown()),
})
const outlineSchema = z.array(z.object({ id: z.string(), type: z.string() })).max(200)
const emptyJsonSchema = { type: "object", properties: {}, additionalProperties: false }
const patchJsonSchema = {
  type: "object",
  properties: { text: { type: "string", minLength: 1, maxLength: 20_000 } },
  required: ["text"],
  additionalProperties: false,
}

const contextFor = (input, owner, operationId, signal) =>
  toolContext({
    principal: owner,
    sessionId: input.sessionId,
    modelEpoch: input.target.epoch,
    expectedRevision: input.target.baseVersion,
    operationId,
    signal,
    budget: createBudget({ calls: 8, bytes: 64_000, items: 400, depth: 16, durationMs: 60_000 }),
  })

export const createDocumentTools = ({
  input,
  owner,
  operationId,
  signal,
  candidate,
  writeCandidate,
}) => {
  const executionContext = contextFor(input, owner, operationId, signal)
  const context = () => executionContext
  const outline = defineTool({
    id: "read_outline",
    description: "Read bounded identifiers and types from the current review candidate",
    effect: "read",
    input: emptySchema,
    output: outlineSchema,
    inputJsonSchema: emptyJsonSchema,
    outputJsonSchema: { type: "array", maxItems: 200, items: { type: "object" } },
    execute: async (_value, execution) => ({
      kind: "success",
      value: candidate().blocks.map((block) => ({ id: block.id, type: block.type })),
      provenance: execution.provenance({ resources: [`candidate:${input.target.modelId}`] }),
      usage: { bytes: 0, items: candidate().blocks.length, depth: 1 },
    }),
  })
  const read = defineTool({
    id: "read_document",
    description: "Read the bounded current review candidate",
    effect: "read",
    input: emptySchema,
    output: documentSchema,
    inputJsonSchema: emptyJsonSchema,
    outputJsonSchema: { type: "object", required: ["format", "blocks"] },
    execute: async (_value, execution) => {
      const value = candidate()
      return {
        kind: "success",
        value,
        provenance: execution.provenance({ resources: [`candidate:${input.target.modelId}`] }),
        usage: { bytes: JSON.stringify(value).length, items: value.blocks.length, depth: 1 },
      }
    },
  })
  const patch = defineTool({
    id: "candidate_patch",
    description: "Append a paragraph to a review-only candidate; never mutate canonical state",
    effect: "propose",
    input: patchSchema,
    output: documentSchema,
    inputJsonSchema: patchJsonSchema,
    outputJsonSchema: { type: "object", required: ["format", "blocks"] },
    async execute({ text }, execution) {
      const current = candidate()
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
      await writeCandidate(next)
      return {
        kind: "success",
        value: next,
        provenance: execution.provenance({ resources: [`proposal:${input.target.modelId}`] }),
        usage: { bytes: JSON.stringify(next).length, items: next.blocks.length, depth: 1 },
      }
    },
  })
  return [bindPartTool(outline, context), bindPartTool(read, context), bindPartTool(patch, context)]
}

export const documentToolSchemas = {
  read_outline: emptyJsonSchema,
  read_document: emptyJsonSchema,
  candidate_patch: patchJsonSchema,
}

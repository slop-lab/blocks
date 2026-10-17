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

const contextFor = (input, owner, operationId, signal, targetIsCurrent) =>
  toolContext({
    principal: owner,
    sessionId: input.sessionId,
    modelEpoch: input.target.epoch,
    expectedRevision: input.target.baseVersion,
    operationId,
    signal,
    budget: createBudget({ calls: 8, bytes: 64_000, items: 400, depth: 16, durationMs: 60_000 }),
    authorize: async (effect) => effect !== "write",
    targetIsCurrent,
  })

export const createDocumentTools = ({
  input,
  owner,
  operationId,
  signal,
  candidate,
  writeCandidate,
  targetIsCurrent,
}) => {
  const executionContext = contextFor(input, owner, operationId, signal, targetIsCurrent)
  const context = () => executionContext
  const outline = defineTool({
    id: "read_outline",
    description: "Read bounded identifiers and types from the current review candidate",
    effect: "read",
    input: emptySchema,
    output: outlineSchema,
    prepare: async (_value, execution) => ({
      kind: "success",
      value: candidate().blocks.map((block) => ({ id: block.id, type: block.type })),
      provenance: execution.provenance({ resources: [`candidate:${input.target.modelId}`] }),
      usage: { items: candidate().blocks.length, depth: 1 },
    }),
  })
  const read = defineTool({
    id: "read_document",
    description: "Read the bounded current review candidate",
    effect: "read",
    input: emptySchema,
    output: documentSchema,
    prepare: async (_value, execution) => {
      const value = candidate()
      return {
        kind: "success",
        value,
        provenance: execution.provenance({ resources: [`candidate:${input.target.modelId}`] }),
        usage: { items: value.blocks.length, depth: 1 },
      }
    },
  })
  const patch = defineTool({
    id: "candidate_patch",
    description: "Append a paragraph to a review-only candidate; never mutate canonical state",
    effect: "propose",
    input: patchSchema,
    output: documentSchema,
    async prepare({ text }, execution) {
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
      return {
        kind: "success",
        value: next,
        provenance: execution.provenance({ resources: [`proposal:${input.target.modelId}`] }),
        usage: { items: next.blocks.length, depth: 1 },
        commit: async () => writeCandidate(next),
      }
    },
  })
  return [bindPartTool(outline, context), bindPartTool(read, context), bindPartTool(patch, context)]
}

export const documentToolSchemas = {
  read_outline: z.toJSONSchema(emptySchema, { io: "input", unrepresentable: "throw" }),
  read_document: z.toJSONSchema(emptySchema, { io: "input", unrepresentable: "throw" }),
  candidate_patch: z.toJSONSchema(patchSchema, { io: "input", unrepresentable: "throw" }),
}

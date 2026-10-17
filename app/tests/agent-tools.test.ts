import { createBudget, defineTool, redactTraceValue, toolContext } from "@block-editor/agent-tools"
import { bindPartTool } from "@block-editor/agent-tools-part"
import { describe, expect, it } from "vitest"
import { z } from "zod"

const inputSchema = z.object({ query: z.string().min(1).max(20) })
const outputSchema = z.object({ matches: z.array(z.string()).max(2) })
const inputJsonSchema = {
  type: "object",
  properties: { query: { type: "string", minLength: 1, maxLength: 20 } },
  required: ["query"],
  additionalProperties: false,
} as const
const outputJsonSchema = {
  type: "object",
  properties: {
    matches: { type: "array", items: { type: "string" }, maxItems: 2 },
  },
  required: ["matches"],
  additionalProperties: false,
} as const

const context = () =>
  toolContext({
    principal: { subject: "author", authority: "demo" },
    sessionId: "session-1",
    modelEpoch: 2,
    expectedRevision: "revision-7",
    operationId: "operation-1",
    signal: new AbortController().signal,
    budget: createBudget({ calls: 2, bytes: 100, items: 3, depth: 2, durationMs: 1_000 }),
  })

describe("agent tool foundation", () => {
  it("returns validated output with provenance when input and budgets are valid", async () => {
    const tool = defineTool({
      id: "documents/search",
      description: "Search an authoritative document host",
      effect: "read",
      input: inputSchema,
      output: outputSchema,
      inputJsonSchema,
      outputJsonSchema,
      execute: async ({ query }, toolExecution) => ({
        kind: "success",
        value: { matches: [query] },
        provenance: toolExecution.provenance({ resources: ["documents"] }),
        usage: { bytes: query.length, items: 1, depth: 1 },
      }),
    })

    const result = await tool.invoke({ query: "roadmap" }, context())

    expect(result).toMatchObject({
      kind: "success",
      value: { matches: ["roadmap"] },
      provenance: {
        operationId: "operation-1",
        principal: { subject: "author", authority: "demo" },
        modelEpoch: 2,
        expectedRevision: "revision-7",
        resources: ["documents"],
      },
    })
    expect(tool.inputJsonSchema).toEqual(inputJsonSchema)
    expect(tool.outputJsonSchema).toEqual(outputJsonSchema)
  })

  it("refuses a call before host execution when its declared budget is exhausted", async () => {
    let executions = 0
    const budget = createBudget({ calls: 1, bytes: 5, items: 1, depth: 1, durationMs: 1_000 })
    const tool = defineTool({
      id: "documents/search",
      description: "Search an authoritative document host",
      effect: "read",
      input: inputSchema,
      output: outputSchema,
      inputJsonSchema,
      outputJsonSchema,
      execute: async (_input, toolExecution) => {
        executions += 1
        return {
          kind: "success",
          value: { matches: ["one", "two"] },
          provenance: toolExecution.provenance({ resources: ["documents"] }),
          usage: { bytes: 6, items: 2, depth: 1 },
        }
      },
    })
    const executionContext = toolContext({
      ...context(),
      budget,
    })

    const first = await tool.invoke({ query: "first" }, executionContext)
    const second = await tool.invoke({ query: "second" }, executionContext)

    expect(first).toMatchObject({ kind: "refusal", reason: "budget_exceeded" })
    expect(second).toMatchObject({ kind: "refusal", reason: "budget_exceeded" })
    expect(executions).toBe(1)
  })

  it("binds exact schemas and effects to a published Part function tool", async () => {
    const tool = defineTool({
      id: "documents/search",
      description: "Search an authoritative document host",
      effect: "read",
      input: inputSchema,
      output: outputSchema,
      inputJsonSchema,
      outputJsonSchema,
      execute: async ({ query }, toolExecution) => ({
        kind: "success",
        value: { matches: [query] },
        provenance: toolExecution.provenance({ resources: ["documents"] }),
        usage: { bytes: query.length, items: 1, depth: 1 },
      }),
    })

    const bound = bindPartTool(tool, context)

    expect(bound.id).toBe("documents/search")
    expect(bound.effects).toBe("read")
    expect(bound.inputJsonSchema).toEqual(inputJsonSchema)
    expect(bound.outputJsonSchema).toEqual(outputJsonSchema)
  })

  it("redacts credentials, prompts, and model traces recursively", () => {
    expect(
      redactTraceValue({
        apiKey: "secret",
        prompt: "private prompt",
        nested: { authorization: "Bearer secret", modelTrace: "private trace", safe: "visible" },
      }),
    ).toEqual({
      apiKey: "[REDACTED]",
      prompt: "[REDACTED]",
      nested: {
        authorization: "[REDACTED]",
        modelTrace: "[REDACTED]",
        safe: "visible",
      },
    })
  })
})

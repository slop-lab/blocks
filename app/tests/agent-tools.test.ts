import { createBudget, defineTool, redactTraceValue, toolContext } from "@block-editor/agent-tools"
import { bindPartTool } from "@block-editor/agent-tools-part"
import { localContext } from "@slop-lab/part"
import { createToolDispatcher } from "@slop-lab/part/tools.js"
import { describe, expect, it } from "vitest"
import { z } from "zod"

const inputSchema = z.object({
  query: z.string().trim().min(1).max(20),
  limit: z.coerce.number().default(1),
})
const outputSchema = z.object({ matches: z.array(z.string()).max(2) })

const context = () =>
  toolContext({
    principal: { subject: "author", authority: "demo" },
    sessionId: "session-1",
    modelEpoch: 2,
    expectedRevision: "revision-7",
    operationId: "operation-1",
    signal: new AbortController().signal,
    budget: createBudget({ calls: 2, bytes: 100, items: 3, depth: 2, durationMs: 1_000 }),
    authorize: async () => true,
    targetIsCurrent: async () => true,
  })

describe("agent tool foundation", () => {
  it("returns validated output with provenance when input and budgets are valid", async () => {
    const tool = defineTool({
      id: "documents/search",
      description: "Search an authoritative document host",
      effect: "read",
      input: inputSchema,
      output: outputSchema,
      prepare: async ({ query }, toolExecution) => ({
        kind: "success",
        value: { matches: [query] },
        provenance: toolExecution.provenance({ resources: ["documents"] }),
        usage: { items: 1, depth: 1 },
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
    expect(tool.inputJsonSchema).toMatchObject({
      type: "object",
      properties: { query: { type: "string" }, limit: { default: 1 } },
      required: ["query"],
    })
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
      prepare: async (_input, toolExecution) => {
        executions += 1
        return {
          kind: "success",
          value: { matches: ["one", "two"] },
          provenance: toolExecution.provenance({ resources: ["documents"] }),
          usage: { items: 2, depth: 1 },
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
      prepare: async ({ query }, toolExecution) => ({
        kind: "success",
        value: { matches: [query] },
        provenance: toolExecution.provenance({ resources: ["documents"] }),
        usage: { items: 1, depth: 1 },
      }),
    })

    const bound = bindPartTool(tool, context)

    expect(bound.id).toBe("documents/search")
    expect(bound.effects).toBe("read")
    expect(bound.inputJsonSchema).toEqual(tool.inputJsonSchema)
    expect(bound.outputJsonSchema).toEqual(tool.outputJsonSchema)
  })

  it("passes Zod-decoded defaults through the real Part dispatcher exactly once", async () => {
    const received: { query: string; limit: number }[] = []
    const tool = defineTool({
      id: "documents/search",
      description: "Search an authoritative document host",
      effect: "read",
      input: inputSchema,
      output: outputSchema,
      prepare: async (input, toolExecution) => {
        received.push(input)
        return {
          kind: "success",
          value: { matches: [input.query] },
          provenance: toolExecution.provenance({ resources: ["documents"] }),
          usage: { items: 1, depth: 1 },
        }
      },
    })
    const dispatcher = createToolDispatcher({ tools: [bindPartTool(tool, context)] })
    expect(dispatcher.ok).toBe(true)
    if (!dispatcher.ok) return

    const dispatched = await dispatcher.value.dispatch(
      { logicalCallId: "call-1", toolId: tool.id, arguments: { query: " roadmap " } },
      localContext(),
    )
    expect(dispatched.ok).toBe(true)
    if (!dispatched.ok) return
    const outcome = await dispatched.value.done

    expect(outcome.phase).toBe("completed")
    expect(received).toEqual([{ query: "roadmap", limit: 1 }])
  })

  it("does not commit a prepared proposal when output, budget, or cancellation fails", async () => {
    const controller = new AbortController()
    let commits = 0
    const tool = defineTool({
      id: "documents/propose",
      description: "Prepare a review artifact",
      effect: "propose",
      input: z.object({ mode: z.enum(["invalid", "large", "cancelled"]) }),
      output: z.object({ text: z.string().max(4) }),
      prepare: async ({ mode }, toolExecution) => {
        if (mode === "cancelled") controller.abort("test")
        return {
          kind: "success",
          value: { text: mode === "invalid" ? "too-long" : "1234" },
          provenance: toolExecution.provenance({ resources: ["artifact:test"] }),
          usage: { items: mode === "large" ? 10 : 1, depth: 1 },
          commit: async () => {
            commits += 1
          },
        }
      },
    })
    const executionContext = toolContext({
      ...context(),
      signal: controller.signal,
      budget: createBudget({ calls: 3, bytes: 100, items: 1, depth: 2, durationMs: 1_000 }),
    })

    expect(await tool.invoke({ mode: "invalid" }, executionContext)).toMatchObject({
      kind: "refusal",
      reason: "invalid_output",
    })
    expect(await tool.invoke({ mode: "large" }, executionContext)).toMatchObject({
      kind: "refusal",
      reason: "budget_exceeded",
    })
    expect(await tool.invoke({ mode: "cancelled" }, executionContext)).toMatchObject({
      kind: "cancelled",
    })
    expect(commits).toBe(0)
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

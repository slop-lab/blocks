import { z } from "zod"
import type { DefinedTool, ToolContext, ToolDefinition, ToolResult } from "./contracts.js"

const refusal = <Output>(
  reason: "invalid_input" | "invalid_output" | "budget_exceeded",
  message: string,
): ToolResult<Output> => ({
  kind: "refusal",
  reason,
  message,
})

export const toolContext = (context: Omit<ToolContext, "provenance">): ToolContext => ({
  ...context,
  provenance: ({ resources }) => ({
    operationId: context.operationId,
    principal: context.principal,
    modelEpoch: context.modelEpoch,
    expectedRevision: context.expectedRevision,
    resources,
  }),
})

export const defineTool = <Input, Output>(
  definition: ToolDefinition<Input, Output>,
): DefinedTool<Input, Output> => ({
  id: definition.id,
  description: definition.description,
  effect: definition.effect,
  input: definition.input,
  output: definition.output,
  inputJsonSchema: z.toJSONSchema(definition.input, { io: "input", unrepresentable: "throw" }),
  outputJsonSchema: z.toJSONSchema(definition.output, { io: "output", unrepresentable: "throw" }),
  async invoke(raw, context) {
    if (context.signal.aborted) return { kind: "cancelled", message: "Operation cancelled" }
    if (!context.budget.consumeCall())
      return refusal("budget_exceeded", "Tool call budget exceeded")
    const parsed = definition.input.safeParse(raw)
    if (!parsed.success) return refusal("invalid_input", "Tool input did not match its schema")
    const result = await definition.prepare(parsed.data, context)
    if (result.kind !== "success") return result
    const output = definition.output.safeParse(result.value)
    if (!output.success) return refusal("invalid_output", "Tool output did not match its schema")
    const usage = {
      ...result.usage,
      bytes: new TextEncoder().encode(JSON.stringify(output.data)).byteLength,
    }
    if (!context.budget.consume(usage))
      return refusal("budget_exceeded", "Tool result exceeded its bounded-read budget")
    if (context.signal.aborted) return { kind: "cancelled", message: "Operation cancelled" }
    if (definition.effect !== "read") {
      if (!(await context.authorize(definition.effect)))
        return { kind: "refusal", reason: "not_allowed", message: "Tool effect is not allowed" }
      if (context.signal.aborted) return { kind: "cancelled", message: "Operation cancelled" }
      if (!(await context.targetIsCurrent()))
        return {
          kind: "conflict",
          expectedRevision: context.expectedRevision,
          actualRevision: "changed",
          message: "Tool target changed before commit",
        }
      if (context.signal.aborted) return { kind: "cancelled", message: "Operation cancelled" }
      await result.commit?.()
    }
    return { kind: "success", value: output.data, provenance: result.provenance, usage }
  },
})

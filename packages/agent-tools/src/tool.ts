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
  inputJsonSchema: definition.inputJsonSchema,
  outputJsonSchema: definition.outputJsonSchema,
  async invoke(raw, context) {
    if (context.signal.aborted) return { kind: "cancelled", message: "Operation cancelled" }
    if (!context.budget.consumeCall())
      return refusal("budget_exceeded", "Tool call budget exceeded")
    const parsed = definition.input.safeParse(raw)
    if (!parsed.success) return refusal("invalid_input", "Tool input did not match its schema")
    const result = await definition.execute(parsed.data, context)
    if (result.kind !== "success") return result
    const output = definition.output.safeParse(result.value)
    if (!output.success) return refusal("invalid_output", "Tool output did not match its schema")
    if (!context.budget.consume(result.usage))
      return refusal("budget_exceeded", "Tool result exceeded its bounded-read budget")
    return { ...result, value: output.data }
  },
})

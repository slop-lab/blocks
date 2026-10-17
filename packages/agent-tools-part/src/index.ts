import type { DefinedTool, ToolContext } from "@block-editor/agent-tools"
import type { Contracts, Tools } from "@slop-lab/part/reference/index.js"
import { functionTool } from "@slop-lab/part/tools.js"
import { z } from "zod"

export type BoundPartTool = Tools.InstalledTool & {
  readonly effects: "read" | "write"
  readonly inputJsonSchema: Readonly<Record<string, unknown>>
  readonly outputJsonSchema: Readonly<Record<string, unknown>>
}

export const bindPartTool = <Input, Output>(
  tool: DefinedTool<Input, Output>,
  context: () => ToolContext,
): BoundPartTool => {
  const effects: "read" | "write" = tool.effect === "read" ? "read" : "write"
  const partSchema = <Value>(
    id: string,
    valueSchema: z.ZodType<Value>,
  ): Contracts.Schema<Value> => ({
    ref: { id, version: 1 },
    validate(value) {
      const parsed = valueSchema.safeParse(value)
      return parsed.success
        ? { ok: true, value: parsed.data }
        : {
            ok: false,
            error: parsed.error.issues.map((issue) => ({
              path: issue.path.map((segment) =>
                typeof segment === "symbol" ? (segment.description ?? segment.toString()) : segment,
              ),
              code: issue.code,
              message: issue.message,
            })),
          }
    },
  })
  const resultSchema = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("success"),
      value: tool.output,
      provenance: z.object({
        operationId: z.string(),
        principal: z.object({ subject: z.string(), authority: z.string() }),
        modelEpoch: z.number(),
        expectedRevision: z.union([z.string(), z.number()]),
        resources: z.array(z.string()),
      }),
      usage: z.object({ bytes: z.number(), items: z.number(), depth: z.number() }),
    }),
    z.object({
      kind: z.literal("refusal"),
      reason: z.enum(["invalid_input", "invalid_output", "budget_exceeded", "not_allowed"]),
      message: z.string(),
    }),
    z.object({
      kind: z.literal("conflict"),
      expectedRevision: z.union([z.string(), z.number()]),
      actualRevision: z.union([z.string(), z.number()]),
      message: z.string(),
    }),
    z.object({ kind: z.literal("cancelled"), message: z.string() }),
  ])
  const installed = functionTool({
    id: tool.id,
    description: tool.description,
    effects,
    input: partSchema(`${tool.id}/input`, tool.input),
    output: partSchema(`${tool.id}/result`, resultSchema),
    async execute(value) {
      return tool.invoke(value, context())
    },
  })
  return {
    ...installed,
    effects,
    inputJsonSchema: tool.inputJsonSchema,
    outputJsonSchema: tool.outputJsonSchema,
  }
}

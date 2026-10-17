import type { DefinedTool, ToolContext } from "@block-editor/agent-tools"
import { schema } from "@slop-lab/part"
import type { Tools } from "@slop-lab/part/reference/index.js"
import { functionTool } from "@slop-lab/part/tools.js"

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
  const input = schema(
    `${tool.id}/input`,
    (value): value is Input => tool.input.safeParse(value).success,
  )
  const output = schema(
    `${tool.id}/output`,
    (value): value is Output => tool.output.safeParse(value).success,
  )
  const installed = functionTool({
    id: tool.id,
    description: tool.description,
    effects,
    input,
    output,
    async execute(value) {
      const result = await tool.invoke(value, context())
      if (result.kind !== "success")
        throw new TypeError(`Tool ${tool.id} ${result.kind}: ${result.message}`)
      return result.value
    },
  })
  return {
    ...installed,
    effects,
    inputJsonSchema: tool.inputJsonSchema,
    outputJsonSchema: tool.outputJsonSchema,
  }
}

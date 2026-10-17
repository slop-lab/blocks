import type { z } from "zod"

export type ToolEffect = "read" | "propose" | "write"
export type Principal = { readonly subject: string; readonly authority: string }
export type Revision = string | number

export type ToolUsage = {
  readonly bytes: number
  readonly items: number
  readonly depth: number
}

export type ToolProvenance = {
  readonly operationId: string
  readonly principal: Principal
  readonly modelEpoch: number
  readonly expectedRevision: Revision
  readonly resources: readonly string[]
}

export type ToolResult<Output> =
  | {
      readonly kind: "success"
      readonly value: Output
      readonly provenance: ToolProvenance
      readonly usage: ToolUsage
    }
  | {
      readonly kind: "refusal"
      readonly reason: "invalid_input" | "invalid_output" | "budget_exceeded" | "not_allowed"
      readonly message: string
    }
  | {
      readonly kind: "conflict"
      readonly expectedRevision: Revision
      readonly actualRevision: Revision
      readonly message: string
    }
  | { readonly kind: "cancelled"; readonly message: string }

export type BudgetLimits = ToolUsage & {
  readonly calls: number
  readonly durationMs: number
}

export interface ToolBudget {
  consumeCall(): boolean
  consume(usage: ToolUsage): boolean
}

export type ToolContext = {
  readonly principal: Principal
  readonly sessionId: string
  readonly modelEpoch: number
  readonly expectedRevision: Revision
  readonly operationId: string
  readonly signal: AbortSignal
  readonly budget: ToolBudget
  provenance(input: { readonly resources: readonly string[] }): ToolProvenance
}

export type JsonSchema = Readonly<Record<string, unknown>>

export type ToolDefinition<Input, Output> = {
  readonly id: string
  readonly description: string
  readonly effect: ToolEffect
  readonly input: z.ZodType<Input>
  readonly output: z.ZodType<Output>
  readonly inputJsonSchema: JsonSchema
  readonly outputJsonSchema: JsonSchema
  readonly execute: (input: Input, context: ToolContext) => Promise<ToolResult<Output>>
}

export type DefinedTool<Input, Output> = Omit<ToolDefinition<Input, Output>, "execute"> & {
  readonly invoke: (input: unknown, context: ToolContext) => Promise<ToolResult<Output>>
}

export interface HostPorts<ReadRequest, ReadValue, Proposal, WriteRequest, WriteValue> {
  read(request: ReadRequest, context: ToolContext): Promise<ToolResult<ReadValue>>
  propose(proposal: Proposal, context: ToolContext): Promise<ToolResult<Proposal>>
  write(request: WriteRequest, context: ToolContext): Promise<ToolResult<WriteValue>>
}

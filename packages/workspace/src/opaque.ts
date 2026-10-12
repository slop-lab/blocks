import { z } from "zod"
import { entityIdSchema } from "./ids.js"

const opaqueWorkspaceBlocks = new WeakSet<object>()

const opaqueWorkspaceBlockSchema = z
  .looseObject({ id: entityIdSchema, type: z.string().min(1).max(160) })
  .brand<"OpaqueWorkspaceBlock">()

export type OpaqueWorkspaceBlock = Readonly<z.infer<typeof opaqueWorkspaceBlockSchema>>

export const markOpaqueWorkspaceBlock = (
  value: Readonly<Record<string, unknown>> & { readonly id: string; readonly type: string },
): OpaqueWorkspaceBlock => {
  const opaque = opaqueWorkspaceBlockSchema.parse(value)
  opaqueWorkspaceBlocks.add(opaque)
  return opaque
}

export const isOpaqueWorkspaceBlock = (value: object): value is OpaqueWorkspaceBlock =>
  opaqueWorkspaceBlocks.has(value)

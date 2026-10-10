import { z } from "zod"

export const revisionSchema = z.number().int().positive()

export const revisionedDocumentSchema = z
  .object({
    documentId: z.string().min(1).max(160),
    revision: revisionSchema,
    content: z.unknown(),
    metadata: z.record(z.string(), z.unknown()),
    history: z
      .array(
        z
          .object({
            revision: revisionSchema,
            actorId: z.string().min(1),
            action: z.enum(["created", "updated"]),
            timestamp: z.iso.datetime(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict()

export type RevisionedDocument = z.infer<typeof revisionedDocumentSchema>

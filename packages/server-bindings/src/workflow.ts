import { join } from "node:path"
import { z } from "zod"
import { RevisionConflictError } from "./cas-repository.js"
import { readStored, safeName, withFileQueue, writeStored } from "./file-utils.js"

const auditSchema = z
  .object({
    action: z.enum(["created", "submitted", "approved"]),
    actorId: z.string().min(1),
    timestamp: z.iso.datetime(),
  })
  .strict()
const workflowSchema = z
  .object({
    documentId: z.string().min(1),
    revision: z.number().int().positive(),
    state: z.enum(["draft", "submitted", "approved"]),
    authorId: z.string().min(1),
    submittedDocumentRevision: z.number().int().positive().nullable(),
    audit: z.array(auditSchema),
  })
  .strict()

export type WorkflowRecord = z.infer<typeof workflowSchema>
type WorkflowOptions = { readonly root: string }

export class WorkflowStateError extends Error {
  readonly name = "WorkflowStateError"
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`Expected workflow state ${expected}, received ${actual}`)
  }
}

export class WorkflowRepository {
  constructor(private readonly options: WorkflowOptions) {}

  private path(documentId: string): string {
    return join(this.options.root, `${safeName(documentId)}.json`)
  }

  async read(documentId: string): Promise<WorkflowRecord | null> {
    return readStored(this.path(documentId), workflowSchema)
  }

  async create(documentId: string, authorId: string): Promise<WorkflowRecord> {
    return withFileQueue(this.path(documentId), async () => {
      const existing = await this.read(documentId)
      if (existing !== null) throw new RevisionConflictError(0, existing.revision)
      const timestamp = new Date().toISOString()
      const record = workflowSchema.parse({
        documentId,
        revision: 1,
        state: "draft",
        authorId,
        submittedDocumentRevision: null,
        audit: [{ action: "created", actorId: authorId, timestamp }],
      })
      await writeStored(this.path(documentId), record)
      return record
    })
  }

  submit(
    documentId: string,
    expectedRevision: number,
    actorId: string,
    documentRevision: number,
  ): Promise<WorkflowRecord> {
    return this.transition(
      documentId,
      expectedRevision,
      actorId,
      "draft",
      "submitted",
      "submitted",
      documentRevision,
    )
  }

  approve(documentId: string, expectedRevision: number, actorId: string): Promise<WorkflowRecord> {
    return this.transition(
      documentId,
      expectedRevision,
      actorId,
      "submitted",
      "approved",
      "approved",
      null,
    )
  }

  private async transition(
    documentId: string,
    expectedRevision: number,
    actorId: string,
    expectedState: WorkflowRecord["state"],
    state: WorkflowRecord["state"],
    action: "submitted" | "approved",
    documentRevision: number | null,
  ): Promise<WorkflowRecord> {
    return withFileQueue(this.path(documentId), async () => {
      const current = await this.read(documentId)
      if (current === null) throw new RevisionConflictError(expectedRevision, 0)
      if (current.revision !== expectedRevision)
        throw new RevisionConflictError(expectedRevision, current.revision)
      if (current.state !== expectedState)
        throw new WorkflowStateError(expectedState, current.state)
      const record = workflowSchema.parse({
        ...current,
        revision: current.revision + 1,
        state,
        submittedDocumentRevision: documentRevision ?? current.submittedDocumentRevision,
        audit: [...current.audit, { action, actorId, timestamp: new Date().toISOString() }],
      })
      await writeStored(this.path(documentId), record)
      return record
    })
  }
}

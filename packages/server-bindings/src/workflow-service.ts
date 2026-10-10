import type { RevisionedDocument } from "@block-editor/bindings"
import type { FileCasRepository } from "./cas-repository.js"
import { type WorkflowRecord, type WorkflowRepository, WorkflowStateError } from "./workflow.js"

type ServiceOptions = {
  readonly documents: FileCasRepository
  readonly workflows: WorkflowRepository
}

const documentQueues = new Map<string, Promise<void>>()

const coordinate = async <T>(documentId: string, operation: () => Promise<T>): Promise<T> => {
  const previous = documentQueues.get(documentId) ?? Promise.resolve()
  let release = (): void => undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.then(() => current)
  documentQueues.set(documentId, queued)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (documentQueues.get(documentId) === queued) documentQueues.delete(documentId)
  }
}

export class WorkflowService {
  constructor(private readonly options: ServiceOptions) {}

  save(input: {
    readonly documentId: string
    readonly expectedRevision?: number
    readonly content: unknown
    readonly metadata?: Readonly<Record<string, unknown>>
    readonly actorId: string
  }): Promise<RevisionedDocument> {
    return coordinate(input.documentId, async () => {
      const workflow = await this.options.workflows.read(input.documentId)
      if (workflow !== null && workflow.state !== "draft")
        throw new WorkflowStateError("draft", workflow.state)
      const current = await this.options.documents.read(input.documentId)
      if (current !== null)
        return this.options.documents.update(
          input.documentId,
          input.expectedRevision ?? 0,
          input.content,
          { actorId: input.actorId },
        )
      const created = await this.options.documents.create(input)
      await this.options.workflows.create(input.documentId, input.actorId)
      return created
    })
  }

  submit(documentId: string, expectedRevision: number, actorId: string): Promise<WorkflowRecord> {
    return coordinate(documentId, async () => {
      const document = await this.requireDocument(documentId)
      const workflow = await this.requireWorkflow(documentId)
      if (workflow.authorId !== actorId) throw new WorkflowStateError("author", actorId)
      return this.options.workflows.submit(documentId, expectedRevision, actorId, document.revision)
    })
  }

  approve(documentId: string, expectedRevision: number, actorId: string): Promise<WorkflowRecord> {
    return coordinate(documentId, async () => {
      const document = await this.requireDocument(documentId)
      const workflow = await this.requireWorkflow(documentId)
      if (workflow.submittedDocumentRevision !== document.revision)
        throw new WorkflowStateError(
          `document revision ${workflow.submittedDocumentRevision ?? "missing"}`,
          `document revision ${document.revision}`,
        )
      return this.options.workflows.approve(documentId, expectedRevision, actorId)
    })
  }

  private async requireDocument(documentId: string): Promise<RevisionedDocument> {
    const record = await this.options.documents.read(documentId)
    if (record === null) throw new WorkflowStateError("document", "missing")
    return record
  }

  private async requireWorkflow(documentId: string): Promise<WorkflowRecord> {
    const record = await this.options.workflows.read(documentId)
    if (record === null) throw new WorkflowStateError("workflow", "missing")
    return record
  }
}

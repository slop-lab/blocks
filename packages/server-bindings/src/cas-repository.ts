import { mkdir, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { type RevisionedDocument, revisionedDocumentSchema } from "@block-editor/bindings"
import { readStored, safeName, withFileQueue, writeStored } from "./file-utils.js"

export class RevisionConflictError extends Error {
  readonly name = "RevisionConflictError"
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`Expected revision ${expected}, received ${actual}`)
  }
}

type RepositoryOptions = { readonly root: string }
type CreateDocument = {
  readonly documentId: string
  readonly content: unknown
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly actorId?: string
}

export class FileCasRepository {
  constructor(private readonly options: RepositoryOptions) {}

  private path(documentId: string): string {
    return join(this.options.root, `${safeName(documentId)}.json`)
  }

  async read(documentId: string): Promise<RevisionedDocument | null> {
    return readStored(this.path(documentId), revisionedDocumentSchema)
  }

  async list(): Promise<readonly RevisionedDocument[]> {
    await mkdir(this.options.root, { recursive: true })
    const names = (await readdir(this.options.root, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -5))
      .sort()
    const records = await Promise.all(names.map((name) => this.read(name)))
    return records.filter((record): record is RevisionedDocument => record !== null)
  }

  async create(input: CreateDocument): Promise<RevisionedDocument> {
    return withFileQueue(this.path(input.documentId), async () => {
      const existing = await this.read(input.documentId)
      if (existing !== null) throw new RevisionConflictError(0, existing.revision)
      const timestamp = new Date().toISOString()
      const record = revisionedDocumentSchema.parse({
        documentId: input.documentId,
        revision: 1,
        content: input.content,
        metadata: input.metadata ?? {},
        history: [
          { revision: 1, actorId: input.actorId ?? "system", action: "created", timestamp },
        ],
      })
      await writeStored(this.path(input.documentId), record)
      return record
    })
  }

  async update(
    documentId: string,
    expectedRevision: number,
    content: unknown,
    audit: { readonly actorId: string },
  ): Promise<RevisionedDocument> {
    return withFileQueue(this.path(documentId), async () => {
      const current = await this.read(documentId)
      if (current === null) throw new RevisionConflictError(expectedRevision, 0)
      if (current.revision !== expectedRevision)
        throw new RevisionConflictError(expectedRevision, current.revision)
      const revision = current.revision + 1
      const record = revisionedDocumentSchema.parse({
        ...current,
        revision,
        content,
        history: [
          ...current.history,
          {
            revision,
            actorId: audit.actorId,
            action: "updated",
            timestamp: new Date().toISOString(),
          },
        ],
      })
      await writeStored(this.path(documentId), record)
      return record
    })
  }

  async delete(documentId: string, expectedRevision: number): Promise<void> {
    await withFileQueue(this.path(documentId), async () => {
      const current = await this.read(documentId)
      if (current === null) throw new RevisionConflictError(expectedRevision, 0)
      if (current.revision !== expectedRevision)
        throw new RevisionConflictError(expectedRevision, current.revision)
      await rm(this.path(documentId))
    })
  }
}

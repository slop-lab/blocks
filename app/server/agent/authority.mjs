import { join } from "node:path"
import { FileCasRepository, RevisionConflictError } from "@block-editor/server-bindings"
import { databaseSchema, patchDatabaseRow } from "@block-editor/workspace"
import {
  loadMarkdownFile,
  MarkdownRequestError,
  markdownRoot,
  saveMarkdownFile,
} from "../markdown-core.mjs"
import { mixedSchema } from "../ownership-content.mjs"
import { withWorkspaceMutation } from "../workspace-mutation-queue.mjs"
import { validateWorkspaceEntity } from "../workspace-validation.mjs"
import { artifactIsIntact } from "./artifacts.mjs"

const workspaceRepositories = (root) => ({
  trees: new FileCasRepository({ root: join(root, "workspace", "trees") }),
  pages: new FileCasRepository({ root: join(root, "workspace", "pages") }),
  databases: new FileCasRepository({ root: join(root, "workspace", "databases") }),
  sources: new FileCasRepository({ root: join(root, "workspace", "sources") }),
})

const markdownContext = async (target) => {
  if (target.resourceId === undefined) throw new RangeError("Markdown file is required")
  const file = await loadMarkdownFile(markdownRoot(), target.resourceId)
  return {
    document: null,
    authority: { kind: "markdown", resourceId: file.name, revision: file.revision },
    sources: [`markdown:${file.name}@${file.revision}`],
    context: { kind: "markdown", file },
  }
}

const workspaceContext = async (root, target) => {
  if (target.resourceId === undefined) throw new RangeError("Workspace database is required")
  const record = await workspaceRepositories(root).databases.read(target.resourceId)
  if (record === null) throw new RangeError("Workspace database is unavailable")
  const database = databaseSchema.parse(record.content)
  return {
    document: null,
    authority: { kind: "workspace", resourceId: record.documentId, revision: record.revision },
    sources: [`workspace-database:${record.documentId}@${record.revision}`],
    context: { kind: "workspace", database, revision: record.revision },
  }
}

const mixedContext = async (root, target) => {
  if (target.taskId === undefined) throw new RangeError("Mixed backlog task is required")
  const repository = new FileCasRepository({ root: join(root, "ownership") })
  const record = await repository.read("mixed-backlog")
  if (record === null) throw new RangeError("Mixed backlog is unavailable")
  const content = mixedSchema.parse(record.content)
  const task = content.tasks.find((item) => item.id === target.taskId)
  if (task === undefined) throw new RangeError("Mixed backlog task is unavailable")
  if (target.dependencyVersion !== undefined && task.version !== target.dependencyVersion)
    throw new RangeError("Mixed backlog task dependency is stale")
  const linkedName = content.taskInfoFiles[task.id]
  const linked =
    linkedName === undefined ? null : await loadMarkdownFile(markdownRoot(), linkedName)
  const current = content.proposals.find(
    (item) => item.taskId === task.id && item.dependencyVersion === task.version,
  )
  return {
    document: null,
    authority: {
      kind: "mixed-backlog",
      resourceId: task.id,
      revision: record.revision,
      dependencyVersion: task.version,
    },
    sources: [
      `mixed-backlog@${record.revision}`,
      `task:${task.id}@${task.version}`,
      ...(linked === null ? [] : [`markdown:${linked.name}@${linked.revision}`]),
    ],
    context: { kind: "mixed-backlog", content, task, current: current?.document ?? null, linked },
  }
}

export const loadAuthoritativeCandidate = async (root, input) => {
  switch (input.target.modelId) {
    case "markdown-git":
      return markdownContext(input.target)
    case "structured-workspace":
      return workspaceContext(root, input.target)
    case "mixed-backlog":
      return mixedContext(root, input.target)
    default:
      return {
        document: structuredClone(input.document),
        authority: { kind: "client-draft" },
        sources: ["client-review-draft"],
        context: { kind: "client-draft", document: structuredClone(input.document) },
      }
  }
}

const markdownLines = (content) => content.match(/.*(?:\r\n|\n|$)/g)?.filter(Boolean) ?? []

const applyMarkdown = async (artifact) => {
  const file = await loadMarkdownFile(markdownRoot(), artifact.file)
  if (file.revision !== artifact.revision)
    return { kind: "conflict", actualRevision: file.revision }
  const lines = markdownLines(file.content)
  const start = artifact.startLine - 1
  const end = artifact.endLine
  if (lines.slice(start, end).join("") !== artifact.before)
    return { kind: "conflict", actualRevision: file.revision }
  try {
    const saved = await saveMarkdownFile(markdownRoot(), {
      name: artifact.file,
      expectedRevision: artifact.revision,
      content: `${lines.slice(0, start).join("")}${artifact.after}${lines.slice(end).join("")}`,
    })
    return { kind: "applied", revision: saved.revision }
  } catch (error) {
    if (error instanceof MarkdownRequestError && error.status === 409)
      return { kind: "conflict", actualRevision: error.details.revision }
    throw error
  }
}

const applyWorkspace = (root, artifact, actorId) =>
  withWorkspaceMutation(join(root, "workspace"), async () => {
    const repositories = workspaceRepositories(root)
    const current = await repositories.databases.read(artifact.databaseId)
    if (current === null) return { kind: "conflict", actualRevision: "missing" }
    if (current.revision !== artifact.revision)
      return { kind: "conflict", actualRevision: current.revision }
    const database = databaseSchema.parse(current.content)
    const row = database.rows.find((item) => item.id === artifact.rowId)
    if (row?.values[artifact.propertyId] !== artifact.before)
      return { kind: "conflict", actualRevision: current.revision }
    const content = databaseSchema.parse({
      ...patchDatabaseRow(database, artifact.rowId, artifact.propertyId, artifact.after),
      version: database.version + 1,
    })
    await validateWorkspaceEntity({
      kind: "databases",
      id: artifact.databaseId,
      content,
      repositories,
    })
    try {
      const saved = await repositories.databases.update(
        artifact.databaseId,
        artifact.revision,
        content,
        { actorId },
      )
      return { kind: "applied", revision: saved.revision }
    } catch (error) {
      if (error instanceof RevisionConflictError)
        return { kind: "conflict", actualRevision: error.actual }
      throw error
    }
  })

const applyMixed = async (root, artifact, actorId) => {
  const repository = new FileCasRepository({ root: join(root, "ownership") })
  const current = await repository.read("mixed-backlog")
  if (current === null) return { kind: "conflict", actualRevision: "missing" }
  if (current.revision !== artifact.repositoryRevision)
    return { kind: "conflict", actualRevision: current.revision }
  const content = mixedSchema.parse(current.content)
  const task = content.tasks.find((item) => item.id === artifact.taskId)
  if (task === undefined || task.version !== artifact.dependencyVersion)
    return { kind: "conflict", actualRevision: task?.version ?? "missing" }
  const currentProposal = content.proposals.find(
    (item) =>
      item.taskId === artifact.taskId && item.dependencyVersion === artifact.dependencyVersion,
  )
  if (JSON.stringify(currentProposal?.document ?? null) !== JSON.stringify(artifact.before))
    return { kind: "conflict", actualRevision: current.revision }
  for (const evidence of artifact.evidence) {
    const linked = await loadMarkdownFile(markdownRoot(), evidence.name)
    if (linked.revision !== evidence.revision)
      return { kind: "conflict", actualRevision: linked.revision }
  }
  const proposal = {
    id: currentProposal?.id ?? `agent-${artifact.taskId}`,
    taskId: artifact.taskId,
    document: artifact.after,
    dependencyVersion: artifact.dependencyVersion,
  }
  const next = {
    ...content,
    proposals: [
      ...content.proposals.filter(
        (item) =>
          item.taskId !== artifact.taskId || item.dependencyVersion !== artifact.dependencyVersion,
      ),
      proposal,
    ],
  }
  try {
    const saved = await repository.update("mixed-backlog", artifact.repositoryRevision, next, {
      actorId,
    })
    return { kind: "applied", revision: saved.revision }
  } catch (error) {
    if (error instanceof RevisionConflictError)
      return { kind: "conflict", actualRevision: error.actual }
    throw error
  }
}

export const applyAuthoritativeCandidate = (root, run, actorId) => {
  if (!artifactIsIntact(run.artifact))
    return Promise.resolve({ kind: "conflict", actualRevision: "artifact-fingerprint" })
  switch (run.artifact.kind) {
    case "markdown-replacement":
      return applyMarkdown(run.artifact)
    case "workspace-row-status":
      return applyWorkspace(root, run.artifact, actorId)
    case "mixed-task-plan":
      return applyMixed(root, run.artifact, actorId)
    default:
      throw new TypeError("Unsupported agent artifact")
  }
}

import { join } from "node:path"
import { FileCasRepository, RevisionConflictError } from "@block-editor/server-bindings"
import { pageDocumentSchema } from "@block-editor/workspace"
import {
  loadMarkdownFile,
  MarkdownRequestError,
  markdownRoot,
  saveMarkdownFile,
} from "../markdown-core.mjs"
import { mixedSchema } from "../ownership-content.mjs"
import { validateWorkspaceEntity } from "../workspace-validation.mjs"

const textBlock = (id, type, text, attrs = {}) => ({
  id,
  type,
  attrs,
  content: [{ kind: "text", text, marks: [] }],
})

const workspaceText = (block) => {
  if (typeof block.text === "string") return block.text
  if (typeof block.heading === "string") return block.heading
  if (typeof block.pageId === "string") return `Page: ${block.pageId}`
  if (typeof block.databaseId === "string") return `Database: ${block.databaseId}`
  return block.type
}

const flattenWorkspace = (blocks) => {
  const flattened = []
  const visit = (block, depth) => {
    flattened.push(
      textBlock(block.id, "paragraph", workspaceText(block), {
        workspaceType: block.type,
        depth,
      }),
    )
    if (Array.isArray(block.children)) for (const child of block.children) visit(child, depth + 1)
  }
  for (const block of blocks) visit(block, 1)
  return flattened
}

const mixedCandidate = async (root, target) => {
  const repository = new FileCasRepository({ root: join(root, "ownership") })
  const record = await repository.read("mixed-backlog")
  if (record === null) throw new RangeError("Mixed backlog is unavailable")
  const content = mixedSchema.parse(record.content)
  const task = content.tasks.find((item) => item.id === target.taskId)
  if (task === undefined) throw new RangeError("Mixed backlog task is unavailable")
  if (target.dependencyVersion !== undefined && task.version !== target.dependencyVersion)
    throw new RangeError("Mixed backlog task dependency is stale")
  const proposal = content.proposals.find(
    (item) => item.taskId === task.id && item.dependencyVersion === task.version,
  )
  const document = proposal?.document ?? content.presentations[task.id]
  if (document === undefined) throw new RangeError("Mixed backlog presentation is unavailable")
  const linkedName = content.taskInfoFiles[task.id]
  const linked =
    linkedName === undefined ? null : await loadMarkdownFile(markdownRoot(), linkedName)
  return {
    document,
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
  }
}

const workspaceCandidate = async (root, target) => {
  if (target.resourceId === undefined) throw new RangeError("Workspace page is required")
  const repository = new FileCasRepository({ root: join(root, "workspace", "pages") })
  const record = await repository.read(target.resourceId)
  if (record === null) throw new RangeError("Workspace page is unavailable")
  return {
    document: {
      format: "block-editor/v0.3",
      blocks: flattenWorkspace(record.content.blocks),
    },
    authority: { kind: "workspace", resourceId: record.documentId, revision: record.revision },
    sources: [`workspace:${record.documentId}@${record.revision}`],
  }
}

const markdownCandidate = async (target) => {
  if (target.resourceId === undefined) throw new RangeError("Markdown file is required")
  const file = await loadMarkdownFile(markdownRoot(), target.resourceId)
  return {
    document: {
      format: "block-editor/v0.3",
      blocks: [
        textBlock("markdown-source", "paragraph", file.content, {
          name: file.name,
          revision: file.revision,
        }),
      ],
    },
    authority: { kind: "markdown", resourceId: file.name, revision: file.revision },
    sources: [`markdown:${file.name}@${file.revision}`],
  }
}

export const loadAuthoritativeCandidate = async (root, input) => {
  switch (input.target.modelId) {
    case "markdown-git":
      return markdownCandidate(input.target)
    case "structured-workspace":
      return workspaceCandidate(root, input.target)
    case "mixed-backlog":
      return mixedCandidate(root, input.target)
    default:
      return {
        document: structuredClone(input.document),
        authority: { kind: "client-draft" },
        sources: ["client-review-draft"],
      }
  }
}

const candidateText = (document) =>
  document.blocks
    .flatMap((block) => block.content)
    .map((inline) => inline.text)
    .join("\n\n")

const applyMarkdown = async (authority, candidate) => {
  try {
    const saved = await saveMarkdownFile(markdownRoot(), {
      name: authority.resourceId,
      expectedRevision: authority.revision,
      content: candidateText(candidate),
    })
    return { kind: "applied", revision: saved.revision }
  } catch (error) {
    if (error instanceof MarkdownRequestError && error.status === 409)
      return { kind: "conflict", actualRevision: error.details.revision }
    throw error
  }
}

const workspaceRepositories = (root) => ({
  trees: new FileCasRepository({ root: join(root, "workspace", "trees") }),
  pages: new FileCasRepository({ root: join(root, "workspace", "pages") }),
  databases: new FileCasRepository({ root: join(root, "workspace", "databases") }),
  sources: new FileCasRepository({ root: join(root, "workspace", "sources") }),
})

const applyWorkspace = async (root, authority, candidate, actorId) => {
  const repositories = workspaceRepositories(root)
  const current = await repositories.pages.read(authority.resourceId)
  if (current === null) return { kind: "conflict", actualRevision: "missing" }
  const currentContent = pageDocumentSchema.parse(current.content)
  const text =
    candidate.blocks
      .at(-1)
      ?.content.map((inline) => inline.text)
      .join("") ?? ""
  const content = pageDocumentSchema.parse({
    ...currentContent,
    version: currentContent.version + 1,
    blocks: [...currentContent.blocks, { id: crypto.randomUUID(), type: "paragraph", text }],
  })
  await validateWorkspaceEntity({
    kind: "pages",
    id: authority.resourceId,
    content,
    repositories,
  })
  try {
    const saved = await repositories.pages.update(
      authority.resourceId,
      authority.revision,
      content,
      { actorId },
    )
    return { kind: "applied", revision: saved.revision }
  } catch (error) {
    if (error instanceof RevisionConflictError)
      return { kind: "conflict", actualRevision: error.actual }
    throw error
  }
}

const applyMixed = async (root, authority, candidate, actorId) => {
  const repository = new FileCasRepository({ root: join(root, "ownership") })
  const current = await repository.read("mixed-backlog")
  if (current === null) return { kind: "conflict", actualRevision: "missing" }
  const content = mixedSchema.parse(current.content)
  const task = content.tasks.find((item) => item.id === authority.resourceId)
  if (task === undefined || task.version !== authority.dependencyVersion)
    return { kind: "conflict", actualRevision: task?.version ?? "missing" }
  const proposal = {
    id: `agent-${authority.resourceId}`,
    taskId: authority.resourceId,
    document: candidate,
    dependencyVersion: authority.dependencyVersion,
  }
  const next = {
    ...content,
    proposals: [...content.proposals.filter((item) => item.id !== proposal.id), proposal],
  }
  try {
    const saved = await repository.update("mixed-backlog", authority.revision, next, { actorId })
    return { kind: "applied", revision: saved.revision }
  } catch (error) {
    if (error instanceof RevisionConflictError)
      return { kind: "conflict", actualRevision: error.actual }
    throw error
  }
}

export const applyAuthoritativeCandidate = (root, run, actorId) => {
  if (run.candidate === null)
    return Promise.resolve({ kind: "conflict", actualRevision: "missing" })
  switch (run.authority.kind) {
    case "markdown":
      return applyMarkdown(run.authority, run.candidate)
    case "workspace":
      return applyWorkspace(root, run.authority, run.candidate, actorId)
    case "mixed-backlog":
      return applyMixed(root, run.authority, run.candidate, actorId)
    case "client-draft":
      return Promise.resolve({ kind: "conflict", actualRevision: "not-authoritative" })
    default:
      throw new TypeError("Unsupported agent authority")
  }
}

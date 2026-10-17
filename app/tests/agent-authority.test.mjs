import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileCasRepository } from "@block-editor/server-bindings"
import { afterEach, expect, it } from "vitest"
import { createFixtureModel } from "../server/agent/model.mjs"
import { createAgentRuntime } from "../server/agent/runtime.mjs"
import { initial } from "../server/ownership-content.mjs"
import {
  sampleDatabases,
  sampleDocuments,
  sampleSources,
  sampleWorkspace,
} from "../server/workspace-seed.mjs"

const roots = []
const previousMarkdownRoot = process.env.MARKDOWN_ROOT

afterEach(async () => {
  if (previousMarkdownRoot === undefined) delete process.env.MARKDOWN_ROOT
  else process.env.MARKDOWN_ROOT = previousMarkdownRoot
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const input = (target, instruction) => ({
  kind: "proposal",
  requestId: crypto.randomUUID(),
  sessionId: "session-author",
  instruction,
  target,
  document: { format: "block-editor/v0.3", blocks: [] },
})

const runAndApply = async (runtime, target, instruction) => {
  const started = await runtime.start(input(target, instruction), {
    subject: "author",
    authority: "demo-session",
  })
  const completed = await runtime.wait(started.id)
  const applied = await runtime.apply(completed.id, "author")
  return { completed, applied }
}

const seedWorkspace = async (root) => {
  const workspaceRoot = join(root, "workspace")
  const repositories = {
    trees: new FileCasRepository({ root: join(workspaceRoot, "trees") }),
    pages: new FileCasRepository({ root: join(workspaceRoot, "pages") }),
    databases: new FileCasRepository({ root: join(workspaceRoot, "databases") }),
    sources: new FileCasRepository({ root: join(workspaceRoot, "sources") }),
  }
  await repositories.trees.create({
    documentId: sampleWorkspace.id,
    content: sampleWorkspace,
    actorId: "seed",
  })
  await Promise.all(
    sampleDocuments.map((document) =>
      repositories.pages.create({
        documentId: document.pageId,
        content: document,
        actorId: "seed",
      }),
    ),
  )
  await Promise.all(
    sampleDatabases.map((database) =>
      repositories.databases.create({
        documentId: database.id,
        content: database,
        actorId: "seed",
      }),
    ),
  )
  await Promise.all(
    sampleSources.map((source) =>
      repositories.sources.create({ documentId: source.id, content: source, actorId: "seed" }),
    ),
  )
  return repositories
}

it("runs Markdown, workspace, and mixed-backlog proposals against authoritative hosts", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-authority-"))
  roots.push(root)
  const markdown = join(root, "markdown")
  await mkdir(join(markdown, "tasks"), { recursive: true })
  await writeFile(join(markdown, "README.md"), "# Baseline\n", "utf8")
  await writeFile(join(markdown, "tasks", "TASK-104.md"), "# Linked evidence\n", "utf8")
  process.env.MARKDOWN_ROOT = markdown
  const workspace = await seedWorkspace(root)
  const mixed = new FileCasRepository({ root: join(root, "ownership") })
  await mixed.create({ documentId: "mixed-backlog", content: initial, actorId: "seed" })
  const runtime = await createAgentRuntime({ root, model: createFixtureModel() })

  const markdownResult = await runAndApply(
    runtime,
    { modelId: "markdown-git", resourceId: "README.md", epoch: 1, baseVersion: 1 },
    "Reviewed Markdown evidence",
  )
  const workspaceResult = await runAndApply(
    runtime,
    { modelId: "structured-workspace", resourceId: "tasks", epoch: 1, baseVersion: 1 },
    "Validated workspace section",
  )
  const mixedResult = await runAndApply(
    runtime,
    {
      modelId: "mixed-backlog",
      taskId: "TASK-104",
      dependencyVersion: 1,
      epoch: 1,
      baseVersion: 1,
    },
    "Dependency-aware backlog proposal",
  )

  expect(markdownResult.completed.authority.kind).toBe("markdown")
  expect(markdownResult.applied.kind).toBe("applied")
  expect(await readFile(join(markdown, "README.md"), "utf8")).toContain(
    "Reviewed Markdown evidence",
  )
  expect(workspaceResult.completed.authority.kind).toBe("workspace")
  expect(workspaceResult.completed.artifact).toMatchObject({
    kind: "workspace-row-status",
    rowId: "task-1",
    before: "진행",
    after: "완료",
  })
  expect(workspaceResult.applied.kind).toBe("applied")
  expect((await workspace.databases.read("tasks"))?.content.rows[0].values.status).toBe("완료")
  expect(mixedResult.completed.authority).toMatchObject({
    kind: "mixed-backlog",
    dependencyVersion: 1,
  })
  expect(mixedResult.completed.artifact).toMatchObject({
    kind: "mixed-task-plan",
    taskId: "TASK-104",
    evidence: [expect.objectContaining({ name: "tasks/TASK-104.md" })],
  })
  expect(mixedResult.applied.kind).toBe("applied")
  expect((await mixed.read("mixed-backlog"))?.content.proposals).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "agent-TASK-104", dependencyVersion: 1 }),
    ]),
  )
  await runtime.dispose()
})

it("rejects a mixed-backlog apply after its authoritative task dependency changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-stale-dependency-"))
  roots.push(root)
  const markdown = join(root, "markdown")
  await mkdir(join(markdown, "tasks"), { recursive: true })
  await writeFile(join(markdown, "tasks", "TASK-104.md"), "# Linked evidence\n", "utf8")
  process.env.MARKDOWN_ROOT = markdown
  const mixed = new FileCasRepository({ root: join(root, "ownership") })
  const seeded = await mixed.create({
    documentId: "mixed-backlog",
    content: initial,
    actorId: "seed",
  })
  const runtime = await createAgentRuntime({ root, model: createFixtureModel() })
  const started = await runtime.start(
    input(
      {
        modelId: "mixed-backlog",
        taskId: "TASK-104",
        dependencyVersion: 1,
        epoch: 1,
        baseVersion: seeded.revision,
      },
      "Stale candidate",
    ),
    { subject: "author", authority: "demo-session" },
  )
  const completed = await runtime.wait(started.id)
  await mixed.update(
    "mixed-backlog",
    seeded.revision,
    {
      ...initial,
      tasks: initial.tasks.map((task) =>
        task.id === "TASK-104" ? { ...task, version: task.version + 1 } : task,
      ),
    },
    { actorId: "concurrent-user" },
  )

  const applied = await runtime.apply(completed.id, "author")

  expect(applied).toEqual({ kind: "conflict", actualRevision: 2 })
  expect((await runtime.get(completed.id))?.application).toBe("conflict")
  await runtime.dispose()
})

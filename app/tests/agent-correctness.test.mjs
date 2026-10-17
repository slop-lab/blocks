import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileCasRepository } from "@slop-lab/blocks-server-bindings"
import { afterEach, expect, it } from "vitest"
import { createFixtureModel } from "../server/agent/model.mjs"
import { createAgentRuntime } from "../server/agent/runtime.mjs"
import { initial } from "../server/ownership-content.mjs"
import { withWorkspaceMutation } from "../server/workspace-mutation-queue.mjs"
import {
  sampleDatabases,
  sampleDocuments,
  sampleSources,
  sampleWorkspace,
} from "../server/workspace-seed.mjs"

const roots = []
const previousMarkdownRoot = process.env.MARKDOWN_ROOT
const owner = { subject: "author", authority: "demo-session" }

afterEach(async () => {
  if (previousMarkdownRoot === undefined) delete process.env.MARKDOWN_ROOT
  else process.env.MARKDOWN_ROOT = previousMarkdownRoot
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const runInput = (target, instruction) => ({
  kind: "proposal",
  requestId: crypto.randomUUID(),
  sessionId: "session-author",
  instruction,
  target,
  document: { format: "block-editor/v0.3", blocks: [] },
})

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
    sampleDocuments.map((content) =>
      repositories.pages.create({ documentId: content.pageId, content, actorId: "seed" }),
    ),
  )
  await Promise.all(
    sampleDatabases.map((content) =>
      repositories.databases.create({ documentId: content.id, content, actorId: "seed" }),
    ),
  )
  await Promise.all(
    sampleSources.map((content) =>
      repositories.sources.create({ documentId: content.id, content, actorId: "seed" }),
    ),
  )
  return repositories
}

it("replaces the reviewed mixed proposal slot instead of leaving the seeded proposal current", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-mixed-slot-"))
  roots.push(root)
  const markdown = join(root, "markdown")
  await mkdir(join(markdown, "tasks"), { recursive: true })
  await writeFile(join(markdown, "tasks", "TASK-104.md"), "# Evidence\n", "utf8")
  process.env.MARKDOWN_ROOT = markdown
  const repository = new FileCasRepository({ root: join(root, "ownership") })
  await repository.create({ documentId: "mixed-backlog", content: initial, actorId: "seed" })
  const runtime = await createAgentRuntime({ root, model: createFixtureModel() })
  const started = await runtime.start(
    runInput(
      {
        modelId: "mixed-backlog",
        taskId: "TASK-104",
        dependencyVersion: 1,
        epoch: 1,
        baseVersion: 1,
      },
      "New reviewed plan",
    ),
    owner,
  )
  const completed = await runtime.wait(started.id)

  await runtime.apply(completed.id, "author")

  const proposals = (await repository.read("mixed-backlog")).content.proposals.filter(
    (proposal) => proposal.taskId === "TASK-104" && proposal.dependencyVersion === 1,
  )
  expect(proposals).toHaveLength(1)
  expect(proposals[0].document.blocks[0].content[0].text).toBe("New reviewed plan")
  await runtime.dispose()
})

it("serializes agent database apply on the canonical workspace mutation key", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-workspace-queue-"))
  roots.push(root)
  await seedWorkspace(root)
  const runtime = await createAgentRuntime({ root, model: createFixtureModel() })
  const started = await runtime.start(
    runInput(
      { modelId: "structured-workspace", resourceId: "tasks", epoch: 1, baseVersion: 1 },
      "Complete the row",
    ),
    owner,
  )
  const completed = await runtime.wait(started.id)
  let release
  const barrier = new Promise((resolve) => {
    release = resolve
  })
  let entered = false
  const held = withWorkspaceMutation(join(root, "workspace"), async () => {
    entered = true
    await barrier
  })
  await Promise.resolve()
  expect(entered).toBe(true)

  let settled = false
  const applying = runtime.apply(completed.id, "author").finally(() => {
    settled = true
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(settled).toBe(false)
  release()
  await held
  await expect(applying).resolves.toMatchObject({ kind: "applied" })
  await runtime.dispose()
})

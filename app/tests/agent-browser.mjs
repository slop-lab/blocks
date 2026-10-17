import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { createApplicationServer } from "../server/application.mjs"

const root = await mkdtemp(join(tmpdir(), "agent-browser-"))
const previousMarkdownRoot = process.env.MARKDOWN_ROOT
process.env.MARKDOWN_ROOT = join(root, "markdown")
await mkdir(process.env.MARKDOWN_ROOT, { recursive: true })
await writeFile(join(process.env.MARKDOWN_ROOT, "README.md"), "# Browser baseline\n", "utf8")
const server = createApplicationServer({ runtimeRoot: root })
server.listen(0, "127.0.0.1")
await once(server, "listening")
const address = server.address()
if (address === null || typeof address === "string") throw new TypeError("Missing server address")
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: "networkidle" })

  const postAgent = async (path, data) => {
    const response = await page.request.post(`http://127.0.0.1:${address.port}/api/agent/${path}`, {
      data,
    })
    assert.equal(response.ok(), true)
    return response.json()
  }
  const session = await postAgent("queries", {
    queryId: "block-editor.agent/session",
    version: 1,
    input: null,
  })
  await page.request.get(`http://127.0.0.1:${address.port}/api/workspace`)
  await page.request.get(`http://127.0.0.1:${address.port}/api/ownership/mixed`)
  const runAuthoritativeStory = async (commandId, target, instruction) => {
    const operation = await page.evaluate(
      async ({ commandId, target, instruction, sessionId }) => {
        const watch = await fetch("/api/agent/events", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ surface: "agent-runs" }),
        })
        if (watch.body === null) throw new TypeError("Agent watch stream is unavailable")
        const started = await fetch("/api/agent/commands", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            protocolVersion: 1,
            commandId,
            actionId: "block-editor.agent/start",
            actionVersion: 1,
            input: {
              kind: "proposal",
              requestId: `${commandId}-request`,
              sessionId,
              instruction,
              target,
              document: { format: "block-editor/v0.3", blocks: [] },
            },
          }),
        }).then((response) => response.json())
        if (started.kind !== "accepted") throw new TypeError("Agent command was not accepted")
        const reader = watch.body.getReader()
        const decoder = new TextDecoder()
        let buffered = ""
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) throw new TypeError("Agent watch ended before completion")
          buffered += decoder.decode(chunk.value, { stream: true })
          const frames = buffered.split("\n\n")
          buffered = frames.pop() ?? ""
          for (const frame of frames) {
            const encoded = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n")
            if (encoded.length === 0) continue
            const message = JSON.parse(encoded)
            const items =
              message.kind === "bootstrap" || message.kind === "reset"
                ? message.snapshot.items
                : message.kind === "event" && message.event.type === "part.item/upsert"
                  ? [message.event.payload]
                  : []
            const run = items.find((item) => item.id === started.operation.id)?.payload
            if (run?.status === "failed" || run?.status === "interrupted")
              throw new TypeError(run.error ?? "Agent run failed")
            if (run?.status === "completed") {
              await reader.cancel()
              return started.operation
            }
          }
        }
      },
      {
        commandId,
        target,
        instruction,
        sessionId: session.value.sessionId,
      },
    )
    const applied = await postAgent("commands", {
      protocolVersion: 1,
      commandId: `${commandId}-apply`,
      actionId: "block-editor.agent/apply",
      actionVersion: 1,
      target: operation,
      input: null,
    })
    assert.equal(applied.result.kind, "applied")
  }

  await runAuthoritativeStory(
    "browser-markdown",
    { modelId: "markdown-git", resourceId: "README.md", epoch: 1, baseVersion: 1 },
    "Browser Markdown proposal",
  )
  await runAuthoritativeStory(
    "browser-workspace",
    { modelId: "structured-workspace", resourceId: "research", epoch: 1, baseVersion: 1 },
    "Browser workspace proposal",
  )
  await runAuthoritativeStory(
    "browser-mixed",
    {
      modelId: "mixed-backlog",
      taskId: "TASK-104",
      dependencyVersion: 1,
      epoch: 1,
      baseVersion: 1,
    },
    "Browser mixed proposal",
  )
  const markdownState = await page.request.get(
    `http://127.0.0.1:${address.port}/api/markdown/file?name=README.md`,
  )
  assert.match((await markdownState.json()).content, /Browser Markdown proposal/)
  const workspaceState = await page.request.get(`http://127.0.0.1:${address.port}/api/workspace`)
  assert.match(JSON.stringify(await workspaceState.json()), /Browser workspace proposal/)
  const mixedState = await page.request.get(`http://127.0.0.1:${address.port}/api/ownership/mixed`)
  assert.match(JSON.stringify(await mixedState.json()), /Browser mixed proposal/)

  await page.getByRole("button", { name: "검토 후보 만들기", exact: true }).click()
  const dialog = page.getByRole("dialog")
  const instruction = "브라우저 에이전트 후보"
  await dialog.getByLabel("추가할 제안 문장").fill(instruction)
  await dialog.getByRole("button", { name: "문장으로 수정안 만들기", exact: true }).click()
  await dialog.getByText(instruction, { exact: true }).waitFor()
  assert.equal(await dialog.getByRole("button", { name: "선택한 변경 수락" }).isEnabled(), true)
  await dialog.getByRole("button", { name: "후보 폐기", exact: true }).click()

  await page.getByRole("button", { name: /소유권 예제/ }).click()
  await page.getByRole("button", { name: "혼합 백로그", exact: true }).click()
  await page.getByRole("button", { name: "에이전트 제안 실행", exact: true }).click()
  await page.getByRole("status").filter({ hasText: "에이전트 후보를 만들었습니다" }).waitFor()
  const proposalEditor = page.getByLabel("에이전트 제안 편집기")
  await proposalEditor.waitFor()
  assert.match(await proposalEditor.textContent(), /고객 인터뷰 요약/)
  await page.getByRole("button", { name: "하위 문서 저장", exact: true }).click()
  await page
    .getByRole("status")
    .filter({ hasText: "proposal BlockDocument를 저장했습니다" })
    .waitFor()
  const state = await page.evaluate(
    async () => await fetch("/api/ownership/mixed").then((response) => response.json()),
  )
  assert.match(JSON.stringify(state.proposals), /고객 인터뷰 요약/)
  assert.deepEqual(errors, [])
  console.log("PASS three authoritative Part stories plus review and mixed-backlog UI lifecycle")
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
  if (previousMarkdownRoot === undefined) delete process.env.MARKDOWN_ROOT
  else process.env.MARKDOWN_ROOT = previousMarkdownRoot
}

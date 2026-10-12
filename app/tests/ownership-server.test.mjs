import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { createApplicationServer } from "../server/application.mjs"
import { migrateMixedContent } from "../server/ownership.mjs"

let server
let root

afterEach(async () => {
  server?.closeAllConnections()
  if (server?.listening) await new Promise((resolve) => server.close(resolve))
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

const setup = async () => {
  root = await mkdtemp(join(tmpdir(), "ownership-server-"))
  server = createApplicationServer({ runtimeRoot: root })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("Missing address")
  const base = `http://127.0.0.1:${address.port}`
  const signed = await fetch(`${base}/api/demo/session?identity=author`, { method: "POST" })
  const cookie = signed.headers.getSetCookie()[0]?.split(";", 1)[0]
  return { base, cookie }
}

const request = async (base, cookie, path = "", body) => {
  const response = await fetch(`${base}/api/ownership/mixed${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { response, payload: await response.json() }
}

it("protects workflow status from presentation mutations", async () => {
  const { base, cookie } = await setup()
  const initial = await request(base, cookie)

  const changed = await request(base, cookie, "/presentation", {
    expectedRevision: initial.payload.revision,
    taskId: "TASK-104",
    document: {
      format: "block-editor/v0.3",
      blocks: [
        {
          id: "caption",
          type: "ownership.caption",
          attrs: {},
          content: [{ kind: "text", text: "사용자 배치 메모", marks: [] }],
        },
      ],
    },
  })

  expect(changed.payload.presentations["TASK-104"].blocks[0].content[0].text).toBe(
    "사용자 배치 메모",
  )
  expect(changed.payload.tasks.find((task) => task.id === "TASK-104").status).toBe("running")
})

it("rejects an agent proposal after its task dependency changes", async () => {
  const { base, cookie } = await setup()
  const initial = await request(base, cookie)
  const task = initial.payload.tasks.find((item) => item.id === "TASK-104")
  const status = await request(base, cookie, "/task-status", {
    expectedRevision: initial.payload.revision,
    taskId: task.id,
    status: "done",
  })

  const stale = await request(base, cookie, "/proposal", {
    expectedRevision: status.payload.revision,
    id: "proposal-1",
    taskId: task.id,
    document: initial.payload.proposals[0].document,
    dependencyVersion: task.version,
  })

  expect(stale.response.status).toBe(409)
  expect(stale.payload).toMatchObject({
    error: "stale_dependency",
    actualVersion: task.version + 1,
  })
})

it("rejects a malformed session without failing the ownership API", async () => {
  const { base } = await setup()

  const response = await fetch(`${base}/api/ownership/mixed`, {
    headers: { cookie: "demo_session=malformed.invalid" },
  })

  expect(response.status).toBe(401)
  await expect(response.json()).resolves.toEqual({ error: "forbidden" })
})

it("migrates v1 string layers into v2 block documents", () => {
  const migrated = migrateMixedContent({
    schemaVersion: 1,
    tasks: [{ id: "TASK-1", title: "Legacy", status: "running", version: 1 }],
    presentations: { "TASK-1": "legacy presentation" },
    proposals: [
      { id: "proposal-1", taskId: "TASK-1", document: "legacy proposal", dependencyVersion: 1 },
    ],
    taskInfoFiles: { "TASK-1": "tasks/TASK-1.md" },
  })

  expect(migrated.migrated).toBe(true)
  expect(migrated.content.schemaVersion).toBe(2)
  expect(migrated.content.presentations["TASK-1"].blocks[0].content[0].text).toBe(
    "legacy presentation",
  )
  expect(migrated.content.proposals[0].document.blocks[0].content[0].text).toBe("legacy proposal")
})

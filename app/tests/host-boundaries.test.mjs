import { once } from "node:events"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createApplicationServer } from "../server/application.mjs"
import { loadSessionSecret } from "../server/runtime-secret.mjs"

const resources = []

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    if (resource.kind === "server") {
      resource.value.closeAllConnections()
      await new Promise((resolve) => resource.value.close(resolve))
    } else await rm(resource.value, { recursive: true, force: true })
  }
})

const open = async () => {
  const root = await mkdtemp(join(tmpdir(), "host-boundaries-"))
  resources.push({ kind: "root", value: root })
  const server = createApplicationServer({ runtimeRoot: root })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  resources.unshift({ kind: "server", value: server })
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("Missing address")
  return { base: `http://127.0.0.1:${address.port}`, root }
}

const session = async (base, identity) => {
  const response = await fetch(`${base}/api/demo/session?identity=${identity}`, { method: "POST" })
  return { response, cookie: response.headers.getSetCookie()[0]?.split(";", 1)[0] }
}

const send = (base, path, cookie, body) =>
  fetch(`${base}${path}`, {
    method: path.includes("/workflows/") ? "POST" : "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  })

describe("host input and workflow boundaries", () => {
  it("serializes concurrent HTTP CAS updates into one success and one conflict", async () => {
    const { base } = await open()
    const { cookie } = await session(base, "author")
    await send(base, "/api/documents/team-minutes", cookie, { content: "baseline" })
    const outcomes = await Promise.all([
      send(base, "/api/documents/team-minutes", cookie, { expectedRevision: 1, content: "first" }),
      send(base, "/api/documents/team-minutes", cookie, { expectedRevision: 1, content: "second" }),
    ])
    expect(outcomes.map(({ status }) => status).sort()).toEqual([200, 409])
  })

  it("freezes submitted content and permits only its author to submit", async () => {
    const { base } = await open()
    const author = (await session(base, "author")).cookie
    const reviewer = (await session(base, "reviewer")).cookie
    await send(base, "/api/documents/team-minutes", author, { content: "review this" })
    expect(
      (await send(base, "/api/workflows/team-minutes/submit", reviewer, { expectedRevision: 1 }))
        .status,
    ).toBe(409)
    expect(
      (await send(base, "/api/workflows/team-minutes/submit", author, { expectedRevision: 1 }))
        .status,
    ).toBe(200)
    expect(
      (
        await send(base, "/api/documents/team-minutes", author, {
          expectedRevision: 1,
          content: "changed",
        })
      ).status,
    ).toBe(409)
    expect(
      (await send(base, "/api/workflows/team-minutes/approve", reviewer, { expectedRevision: 2 }))
        .status,
    ).toBe(200)
  })

  it("rejects prototype identities, invalid bodies, and oversized bodies", async () => {
    const { base } = await open()
    expect((await session(base, "__proto__")).response.status).toBe(400)
    const { cookie } = await session(base, "author")
    expect((await send(base, "/api/documents/team-minutes", cookie, { content: "" })).status).toBe(
      400,
    )
    expect(
      (await send(base, "/api/documents/team-minutes", cookie, { content: "ok", extra: true }))
        .status,
    ).toBe(400)
    expect(
      (
        await send(base, "/api/documents/team-minutes", cookie, {
          content: "x".repeat(2 * 1024 * 1024),
        })
      ).status,
    ).toBe(413)
  })

  it("persists a mode-600 random secret and rejects short configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "runtime-secret-"))
    resources.push({ kind: "root", value: root })
    const first = loadSessionSecret(root)
    expect(loadSessionSecret(root)).toBe(first)
    expect((await stat(join(root, "demo-session.secret"))).mode & 0o777).toBe(0o600)
    expect(() => loadSessionSecret(root, "short")).toThrow(TypeError)
  })
})

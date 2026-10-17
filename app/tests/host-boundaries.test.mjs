import { createHmac } from "node:crypto"
import { once } from "node:events"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DemoSessionAuthority } from "@slop-lab/blocks-server-bindings"
import { afterEach, describe, expect, it } from "vitest"
import WebSocket from "ws"
import { createApplicationServer } from "../server/application.mjs"
import { createHostDomain } from "../server/host-domain.mjs"
import { loadSessionSecret } from "../server/runtime-secret.mjs"

const resources = []
const issuer = "block-editor-demo"

const signedPayload = (secret, value) => {
  const payload = Buffer.from(value).toString("base64url")
  const signature = createHmac("sha256", secret).update(payload).digest("base64url")
  return `${payload}.${signature}`
}

const invalidToken = (kind, secret) => {
  if (kind === "stale")
    return new DemoSessionAuthority({
      secret: "stale-session-secret-with-entropy",
      issuer,
    }).issue({ subject: "author", role: "editor", rooms: ["*"] })
  if (kind === "expired")
    return new DemoSessionAuthority({ secret, issuer, lifetimeSeconds: -1 }).issue({
      subject: "author",
      role: "editor",
      rooms: ["*"],
    })
  return signedPayload(secret, "not-json")
}

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
  it("serves the root page and issues a demo session for a fresh request", async () => {
    const { base } = await open()

    const response = await fetch(base)

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    expect(response.headers.getSetCookie()[0]).toMatch(/^demo_session=/)
  })

  it("serves extensionless routes without substituting HTML for missing assets", async () => {
    const { base } = await open()

    const route = await fetch(`${base}/workspace/settings`)
    const missingScript = await fetch(`${base}/assets/missing.js`)
    const legacyFavicon = await fetch(`${base}/favicon.ico`)

    expect(route.status).toBe(200)
    expect(route.headers.get("content-type")).toContain("text/html")
    expect(missingScript.status).toBe(404)
    expect(missingScript.headers.get("content-type")).not.toContain("text/html")
    expect(legacyFavicon.status).toBe(204)
    expect(legacyFavicon.headers.get("content-type")).toBeNull()
  })

  it("recovers a missing favicon request from a malformed demo session", async () => {
    const { base, root } = await open()
    const token = invalidToken("malformed", loadSessionSecret(root))

    const response = await fetch(`${base}/favicon.ico`, {
      headers: { cookie: `demo_session=${token}` },
    })

    expect(response.status).toBe(204)
    expect(response.headers.getSetCookie()[0]).toMatch(/^demo_session=/)
  })

  it.each(["stale", "expired", "malformed"])(
    "recovers the root page from a %s demo session",
    async (kind) => {
      const { base, root } = await open()
      const token = invalidToken(kind, loadSessionSecret(root))

      const response = await fetch(base, { headers: { cookie: `demo_session=${token}` } })

      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("text/html")
      expect(response.headers.getSetCookie()[0]).toMatch(/^demo_session=/)
    },
  )

  it.each(["stale", "expired", "malformed"])(
    "rejects a %s demo session at the protected HTTP boundary",
    async (kind) => {
      const { base, root } = await open()
      const token = invalidToken(kind, loadSessionSecret(root))

      const response = await fetch(`${base}/api/documents/team-minutes`, {
        headers: { cookie: `demo_session=${token}` },
      })

      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({ error: "Demo session required" })
    },
  )

  it("denies an invalid demo session during WebSocket upgrade", async () => {
    const { base, root } = await open()
    const token = invalidToken("stale", loadSessionSecret(root))
    const socket = new WebSocket(`${base.replace("http", "ws")}/collaboration?room=team-minutes`, {
      headers: { cookie: `demo_session=${token}` },
    })
    const status = new Promise((resolve, reject) => {
      socket.once("open", () => reject(new Error("Invalid session upgraded unexpectedly")))
      socket.once("unexpected-response", (_request, response) => {
        response.resume()
        resolve(response.statusCode)
      })
      socket.once("error", reject)
    })

    await expect(status).resolves.toBe(403)
  })

  it("propagates unexpected session verification errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "host-session-errors-"))
    resources.push({ kind: "root", value: root })
    const host = createHostDomain({
      root,
      secret: "unexpected-error-secret-with-entropy",
    })
    const unexpected = new Error("unexpected verification failure")
    host.authority.verify = () => {
      throw unexpected
    }

    expect(() => host.sessionFor({ headers: { cookie: "demo_session=opaque" } })).toThrow(
      unexpected,
    )
  })

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

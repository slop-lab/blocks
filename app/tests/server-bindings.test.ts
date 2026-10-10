import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  AccessDeniedError,
  DemoSessionAuthority,
  FileCasRepository,
  FileRoomStore,
  WorkflowRepository,
} from "@block-editor/server-bindings"
import { afterEach, describe, expect, it } from "vitest"

const roots: string[] = []
const temporaryRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "block-editor-bindings-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("server bindings package", () => {
  it("reopens revisioned content with metadata and history after restart", async () => {
    const root = await temporaryRoot()
    const first = new FileCasRepository({ root: join(root, "documents") })
    await first.create({
      documentId: "minutes",
      content: { blocks: [{ id: "intro" }] },
      metadata: { owner: "author" },
    })
    await first.update(
      "minutes",
      1,
      { blocks: [{ id: "intro", text: "durable" }] },
      { actorId: "author" },
    )

    const reopened = new FileCasRepository({ root: join(root, "documents") })
    const record = await reopened.read("minutes")

    expect(record).toMatchObject({ revision: 2, metadata: { owner: "author" } })
    expect(record?.history).toHaveLength(2)
    expect(record?.content).toEqual({ blocks: [{ id: "intro", text: "durable" }] })
  })

  it("persists binary collaboration state across store instances", async () => {
    const root = await temporaryRoot()
    const first = new FileRoomStore({ root: join(root, "rooms") })
    await first.save("team-minutes", Uint8Array.of(4, 8, 15, 16, 23, 42))

    const reopened = new FileRoomStore({ root: join(root, "rooms") })

    await expect(reopened.load("team-minutes")).resolves.toEqual(
      Uint8Array.of(4, 8, 15, 16, 23, 42),
    )
  })

  it("authorizes room scopes from a signed opaque demo session", () => {
    const authority = new DemoSessionAuthority({
      secret: "test-secret-with-enough-entropy",
      issuer: "tests",
    })
    const token = authority.issue({ subject: "viewer", role: "viewer", rooms: ["public-notes"] })
    const session = authority.verify(token)

    expect(session.subject).toBe("viewer")
    expect(() => authority.require(session, "private-notes", "read")).toThrow(AccessDeniedError)
    expect(() => authority.require(session, "public-notes", "write")).toThrow(AccessDeniedError)
  })

  it("requires explicit versioned submission and approval actions", async () => {
    const root = await temporaryRoot()
    const workflows = new WorkflowRepository({ root: join(root, "workflows") })
    await workflows.create("team-minutes", "author")
    const submitted = await workflows.submit("team-minutes", 1, "author")

    await expect(workflows.approve("team-minutes", 1, "reviewer")).rejects.toMatchObject({
      name: "RevisionConflictError",
    })
    const approved = await workflows.approve("team-minutes", submitted.revision, "reviewer")

    expect(approved.state).toBe("approved")
    expect(approved.audit.map((entry) => entry.action)).toEqual([
      "created",
      "submitted",
      "approved",
    ])
  })
})

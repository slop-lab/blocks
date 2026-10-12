import { SourceRuntimeRegistry } from "@block-editor/bindings"
import { describe, expect, it } from "vitest"

type TestState = {
  readonly content: string
  readonly undo: readonly string[]
}

const registry = () =>
  new SourceRuntimeRegistry<TestState, string>({
    contentOf: (state) => state.content,
    replaceContent: (state, content) => ({ ...state, content }),
    contentEquals: (left, right) => left === right,
  })

describe("canonical source runtime", () => {
  it("Given a registered runtime, When its source is deleted, Then the next open creates a new runtime", () => {
    const runtimes = registry()
    const first = runtimes.open("source-a", {
      state: { content: "A", undo: [] },
      revision: 1,
    })

    runtimes.delete("source-a")
    expect(runtimes.get("source-a")).toBeNull()
    expect(runtimes.open("source-a", { state: { content: "B", undo: [] }, revision: 2 })).not.toBe(
      first,
    )
  })

  it("Given a replacement runtime, When an old owner releases its handle, Then the replacement remains registered", () => {
    const runtimes = registry()
    const first = runtimes.open("source-a", {
      state: { content: "A", undo: [] },
      revision: 1,
    })
    runtimes.delete("source-a")
    const replacement = runtimes.open("source-a", {
      state: { content: "B", undo: [] },
      revision: 2,
    })

    expect(runtimes.release("source-a", first)).toBe(false)
    expect(runtimes.get("source-a")).toBe(replacement)
    expect(runtimes.release("source-a", replacement)).toBe(true)
    expect(runtimes.get("source-a")).toBeNull()
  })

  it("Given two occurrences, When editing moves between them, Then one state and history authority is retained", () => {
    const runtimes = registry()
    const runtime = runtimes.open("source-a", {
      state: { content: "A", undo: [] },
      revision: 3,
    })
    runtime.attach("first")
    runtime.activate("first")
    runtime.updateLocal("first", { content: "AB", undo: ["A"] }, "cause-1")

    runtime.attach("second")
    runtime.activate("second")

    expect(runtime.activeOccurrenceId).toBe("second")
    expect(runtime.state).toEqual({ content: "AB", undo: ["A"] })
    expect(
      runtimes.open("source-a", { state: { content: "ignored", undo: [] }, revision: 9 }),
    ).toBe(runtime)
  })

  it("Given an active occurrence, When only editor state changes, Then no save generation is created", () => {
    const runtime = registry().open("source-a", {
      state: { content: "A", undo: [] },
      revision: 3,
    })
    runtime.attach("first")
    runtime.activate("first")

    runtime.updateState("first", { content: "A", undo: ["selection bookmark"] })

    expect(runtime.state).toEqual({ content: "A", undo: ["selection bookmark"] })
    expect(runtime.pendingSave()).toBeNull()
  })

  it("Given a clean active source, When a newer remote revision arrives, Then the same runtime adopts it", () => {
    const runtime = registry().open("source-a", {
      state: { content: "A", undo: ["before"] },
      revision: 3,
    })
    runtime.attach("first")
    runtime.activate("first")

    const result = runtime.receiveRemote({ content: "remote", revision: 4 })

    expect(result).toEqual({ kind: "applied" })
    expect(runtime.state).toEqual({ content: "remote", undo: ["before"] })
    expect(runtime.baselineRevision).toBe(4)
  })

  it("Given a dirty active source, When remote content advances, Then the original CAS draft is preserved as a conflict", () => {
    const runtime = registry().open("source-a", {
      state: { content: "A", undo: [] },
      revision: 3,
    })
    runtime.attach("first")
    runtime.activate("first")
    runtime.updateLocal("first", { content: "local", undo: ["A"] }, "cause-local")

    const result = runtime.receiveRemote({ content: "remote", revision: 4 })
    const save = runtime.pendingSave()

    expect(result).toEqual({ kind: "conflict", remoteRevision: 4 })
    expect(runtime.state.content).toBe("local")
    expect(save).toMatchObject({ baselineRevision: 3, content: "local", causeId: "cause-local" })
    expect(runtime.receiveRemote({ content: "remote", revision: 4 })).toEqual({ kind: "ignored" })
  })

  it("Given generation B is dirty, When submitted generation A is acknowledged, Then the baseline advances without clearing B", () => {
    const runtime = registry().open("source-a", {
      state: { content: "A", undo: [] },
      revision: 3,
    })
    runtime.attach("first")
    runtime.activate("first")
    runtime.updateLocal("first", { content: "first", undo: ["A"] }, "cause-1")
    const old = runtime.pendingSave()
    runtime.updateLocal("first", { content: "newest", undo: ["A", "first"] }, "cause-2")

    const result = runtime.acknowledge({
      generation: old?.generation ?? 0,
      causeId: "cause-1",
      record: { content: "first", revision: 4 },
    })

    expect(result).toEqual({ kind: "accepted" })
    expect(runtime.state.content).toBe("newest")
    expect(runtime.dirty).toBe(true)
    expect(runtime.pendingSave()).toMatchObject({ baselineRevision: 4, content: "newest" })
  })

  it("Given a submitted generation, When its cause or saved content differs, Then acknowledgement is stale", () => {
    const runtime = registry().open("source-a", {
      state: { content: "A", undo: [] },
      revision: 3,
    })
    runtime.attach("first")
    runtime.activate("first")
    runtime.updateLocal("first", { content: "first", undo: ["A"] }, "cause-1")
    const submitted = runtime.pendingSave()

    expect(
      runtime.acknowledge({
        generation: submitted?.generation ?? 0,
        causeId: "random-cause",
        record: { content: "first", revision: 4 },
      }),
    ).toEqual({ kind: "stale" })
    expect(
      runtime.acknowledge({
        generation: submitted?.generation ?? 0,
        causeId: "cause-1",
        record: { content: "different", revision: 4 },
      }),
    ).toEqual({ kind: "stale" })
    expect(runtime.baselineRevision).toBe(3)
    expect(runtime.dirty).toBe(true)
  })

  it("Given a remote conflict, When the user keeps the local draft, Then it rebases only by explicit recovery", () => {
    const runtime = registry().open("source-a", {
      state: { content: "A", undo: [] },
      revision: 3,
    })
    runtime.attach("first")
    runtime.activate("first")
    runtime.updateLocal("first", { content: "local", undo: ["A"] }, "cause-local")
    runtime.receiveRemote({ content: "remote", revision: 4 })

    runtime.resolveConflict("keep-local")

    expect(runtime.conflict).toBeNull()
    expect(runtime.pendingSave()).toMatchObject({ baselineRevision: 4, content: "local" })
  })

  it("Given composition moves to another occurrence, When the old occurrence ends late, Then the new owner remains composing", () => {
    const runtime = registry().open("source-a", {
      state: { content: "A", undo: [] },
      revision: 3,
    })
    runtime.attach("first")
    runtime.attach("second")
    runtime.activate("first")
    runtime.setComposing("first", true)
    runtime.activate("second")
    runtime.setComposing("second", true)

    runtime.setComposing("first", false)

    expect(runtime.composingOccurrenceId).toBe("second")
  })

  it("Given a remote conflict, When the user accepts remote, Then the runtime becomes clean without losing history", () => {
    const runtime = registry().open("source-a", {
      state: { content: "A", undo: ["before"] },
      revision: 3,
    })
    runtime.attach("first")
    runtime.activate("first")
    runtime.updateLocal("first", { content: "local", undo: ["before", "A"] }, "cause-local")
    runtime.receiveRemote({ content: "remote", revision: 4 })

    runtime.resolveConflict("accept-remote")

    expect(runtime.state).toEqual({ content: "remote", undo: ["before", "A"] })
    expect(runtime.dirty).toBe(false)
    expect(runtime.baselineRevision).toBe(4)
  })
})

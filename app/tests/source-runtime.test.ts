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
  })

describe("canonical source runtime", () => {
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
  })

  it("Given a newer local generation, When an old acknowledgement arrives, Then it cannot clear the draft", () => {
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

    expect(result).toEqual({ kind: "stale" })
    expect(runtime.pendingSave()).toMatchObject({ baselineRevision: 3, content: "newest" })
  })
})

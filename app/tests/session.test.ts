import { undo } from "prosemirror-history"
import { describe, expect, it } from "vitest"
import { exportMarkdown, readBlocks } from "../src/core/headless"
import type { BlockDocument, ChangeEvent } from "../src/core/types"
import { ModelSession } from "../src/pm/session"

const document: BlockDocument = {
  format: "block-editor/v0.3",
  blocks: [
    {
      id: "p",
      type: "paragraph",
      attrs: {},
      content: [{ kind: "text", text: "draft", marks: [] }],
    },
  ],
}
const create = () =>
  new ModelSession({ modelId: "note", document, epoch: 1, version: 0, readOnly: false })

describe("model session lifetime", () => {
  it("keeps a newer surface attached when a released lease is called again", () => {
    const session = create()
    const first = session.attach()
    expect(session.attach()).toBeNull()
    first?.()
    const second = session.attach()
    expect(second).toBeTypeOf("function")
    first?.()
    expect(session.attach()).toBeNull()
  })
  it("reports deleted external targets and appended ID repairs", () => {
    const session = create()
    const events: ChangeEvent[] = []
    session.subscribe((event) => {
      if (event !== null) events.push(event)
    })
    session.dispatch(session.state.tr.split(3))
    const splitIds = session.snapshot.blocks.map((block) => block.id)
    expect(events[0]?.changedBlockIds).toEqual(splitIds)
    session.applyExternal({
      modelId: "note",
      epoch: 1,
      baseVersion: 1,
      requestId: "replace",
      document,
    })
    expect(events[1]?.changedBlockIds).toEqual(splitIds)
    expect(events[1]?.origin).toBe("host")
  })
  it("retains undo across surface detach", () => {
    const session = create()
    const release = session.attach()
    session.dispatch(session.state.tr.insertText("A", 1))
    release?.()
    session.attach()
    undo(session.state, (transaction) => session.dispatch(transaction))
    expect(session.state.doc.textContent).toBe("draft")
  })
  it("keeps selection-only and refused transactions out of content events", () => {
    const session = new ModelSession({
      modelId: "note",
      document,
      epoch: 1,
      version: 0,
      readOnly: true,
    })
    const events: ChangeEvent[] = []
    session.subscribe((event) => {
      if (event !== null) events.push(event)
    })
    session.dispatch(session.state.tr)
    session.dispatch(session.state.tr.insertText("rejected", 1))
    expect(events).toEqual([])
    expect(session.version).toBe(0)
  })
  it("rejects an older external response after a newer response", () => {
    const session = create()
    const update = { modelId: "note", epoch: 1, baseVersion: 0, requestId: "second", document }
    expect(session.applyExternal(update).kind).toBe("applied")
    expect(session.applyExternal({ ...update, requestId: "first" }).kind).toBe("conflict")
    expect(session.version).toBe(1)
  })
  it("preserves IME draft when a deferred update becomes stale", () => {
    const session = create()
    session.setComposing(true)
    expect(
      session.applyExternal({
        modelId: "note",
        epoch: 1,
        baseVersion: 0,
        requestId: "remote",
        document,
      }).kind,
    ).toBe("deferred")
    session.dispatch(session.state.tr.insertText("한글", 1))
    session.setComposing(false)
    expect(session.flushExternal()?.kind).toBe("conflict")
    expect(session.state.doc.textContent).toBe("한글draft")
  })
  it("invalidates undo on external content instead of reverting remote content", () => {
    const session = create()
    session.dispatch(session.state.tr.insertText("local", 1))
    const remote: BlockDocument = {
      ...document,
      blocks: [...document.blocks, { id: "remote", type: "paragraph", attrs: {}, content: [] }],
    }
    session.applyExternal({
      modelId: "note",
      epoch: 1,
      baseVersion: 1,
      requestId: "update",
      document: remote,
    })
    expect(undo(session.state)).toBe(false)
    expect(session.snapshot.blocks.map((block) => block.id)).toContain("remote")
  })
  it("does not reuse a bookmark across epochs or deleted targets", () => {
    const session = create()
    const mark = session.bookmark("p")
    expect(session.resolve({ ...mark, epoch: 2 }).kind).toBe("missing")
    expect(session.resolve({ ...mark, blockId: "gone" }).kind).toBe("missing")
  })
})

describe("headless read budgets", () => {
  it("returns an explicit continuation instead of presenting truncation as completeness", () => {
    const large: BlockDocument = {
      ...document,
      blocks: [...document.blocks, { id: "second", type: "paragraph", attrs: {}, content: [] }],
    }
    const page = readBlocks(large, { maxBlocks: 1, maxBytes: 1000 })
    expect(page.omitted).toBe(true)
    expect(page.nextCursor).toBe(1)
    expect(readBlocks(large, { maxBlocks: 1, maxBytes: 1000, cursor: 1 }).omitted).toBe(false)
  })
  it("reports dropped marks and bounds malformed heading levels", () => {
    const input: BlockDocument = {
      ...document,
      blocks: [
        {
          id: "h",
          type: "heading",
          attrs: { level: 1e12 },
          content: [{ kind: "text", text: "title", marks: [{ type: "strong" }] }],
        },
      ],
    }
    const result = exportMarkdown(input, { maxBlocks: 10, maxText: 100 })
    expect(result.output).toBe("## title")
    expect(result.losses).toHaveLength(1)
  })
})

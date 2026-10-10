import { describe, expect, it } from "vitest"
import { createBindingState, resolveBinding } from "../src/core/bindings"
import { decodeDocument, encodeDocument } from "../src/core/codec"
import { copyBlocks } from "../src/core/copy"
import { decideExternalUpdate, resetSession } from "../src/core/external"
import { exportHtml, exportMarkdown, readOutline } from "../src/core/headless"
import { createRegistry } from "../src/core/registry"
import { acceptReview } from "../src/core/review"
import type { BlockDocument } from "../src/core/types"
import { createEditorState } from "../src/pm/editor"
import { pmToSnapshot, snapshotToPm } from "../src/pm/snapshot"

const documentFixture: BlockDocument = {
  format: "block-editor/v0.3",
  blocks: [
    {
      id: "block-a",
      type: "heading",
      attrs: { level: 1 },
      content: [{ kind: "text", text: "설계 노트", marks: [] }],
    },
    {
      id: "block-x",
      type: "vendor.diagram",
      attrs: { vendor: { points: [1, 2, 3] } },
      content: [{ kind: "opaque", raw: { nested: ["preserve", 7] } }],
    },
  ],
}

describe("lossless document boundary", () => {
  it("preserves unknown blocks and inline payloads when decoded and encoded", () => {
    // Given external JSON containing an unknown extension block
    const external: unknown = JSON.parse(JSON.stringify(documentFixture))

    // When it crosses the validated codec boundary
    const encoded = encodeDocument(decodeDocument(external))

    // Then its full JSON representation survives unchanged
    expect(JSON.parse(encoded)).toEqual(external)
  })

  it("rejects duplicate stable IDs", () => {
    // Given a document whose PM nodes would share a host identity
    const duplicate = {
      ...documentFixture,
      blocks: [documentFixture.blocks[0], documentFixture.blocks[0]],
    }

    // When it crosses the codec boundary, Then identity validation fails
    expect(() => decodeDocument(duplicate)).toThrowError(/duplicate/i)
  })
})

describe("clipboard identity", () => {
  it("creates fresh IDs and remaps known internal references", () => {
    // Given copied blocks with a relation inside the copied range
    const source: BlockDocument = {
      format: "block-editor/v0.3",
      blocks: [
        { id: "a", type: "paragraph", attrs: {}, content: [] },
        { id: "b", type: "caption", attrs: { refBlockId: "a" }, content: [] },
      ],
    }

    // When copied with deterministic ID allocation
    const copied = copyBlocks(source.blocks, (oldId) => `copy-${oldId}`)

    // Then identities and supported references point only to the copies
    expect(copied.map((block) => block.id)).toEqual(["copy-a", "copy-b"])
    expect(copied[1]?.attrs).toEqual({ refBlockId: "copy-a" })
  })

  it("does not interpret vendor refBlockId attributes as declared references", () => {
    const source: BlockDocument = {
      format: "block-editor/v0.3",
      blocks: [
        {
          id: "vendor",
          type: "vendor.diagram",
          attrs: { refBlockId: "vendor" },
          content: [{ kind: "opaque", raw: { relation: "vendor" } }],
        },
      ],
    }

    const copied = copyBlocks(source.blocks, (oldId) => `copy-${oldId}`)

    expect(copied[0]?.id).toBe("copy-vendor")
    expect(copied[0]?.attrs["refBlockId"]).toBe("vendor")
  })
})

describe("external update protocol", () => {
  it("defers a current update while composition is active", () => {
    // Given an active IME composition at version 4
    const clock = { epoch: 2, version: 4, composing: true, pending: null }

    // When the host submits a matching update
    const result = decideExternalUpdate(clock, {
      epoch: 2,
      baseVersion: 4,
      document: documentFixture,
    })

    // Then application is deferred rather than interrupting composition
    expect(result.kind).toBe("deferred")
  })

  it("reports a conflict instead of overwriting a newer local version", () => {
    // Given a local version ahead of the host base
    const clock = { epoch: 2, version: 5, composing: false, pending: null }

    // When stale remote content arrives
    const result = decideExternalUpdate(clock, {
      epoch: 2,
      baseVersion: 4,
      document: documentFixture,
    })

    // Then it becomes an explicit conflict
    expect(result.kind).toBe("conflict")
  })

  it("resets epoch, version, history marker, and pending work explicitly", () => {
    // Given a session with versioned work and a deferred update
    const clock = { epoch: 7, version: 9, composing: true, pending: { reason: "ime" } }

    // When the host resets the session
    const reset = resetSession(clock)

    // Then all prior update lineage is invalidated
    expect(reset).toEqual({
      epoch: 8,
      version: 0,
      composing: false,
      pending: null,
      historyReset: true,
    })
  })
})

describe("host binding and review guards", () => {
  it("ignores a stale response while preserving another block draft", () => {
    // Given two independently dirty bindings and a bookmark for A version 1
    const state = createBindingState([
      { blockId: "a", version: 2, draft: "new A", dirty: true },
      { blockId: "b", version: 3, draft: "draft B", dirty: true },
    ])

    // When the late A response resolves
    const resolved = resolveBinding(state, { blockId: "a", version: 1 }, "saved old A")

    // Then stale A is ignored and B remains dirty
    expect(resolved.kind).toBe("stale")
    expect(resolved.state.entries["b"]?.dirty).toBe(true)
  })

  it("accepts a review only against its captured base version", () => {
    // Given a candidate produced from document version 3
    const candidate = { id: "review-1", baseVersion: 3, document: documentFixture }

    // When the current document has advanced
    const result = acceptReview(candidate, 4)

    // Then explicit rebase is required
    expect(result.kind).toBe("base_mismatch")
  })
})

describe("bounded headless projection", () => {
  it("reads outline and exports escaped HTML without starting an editor", () => {
    // Given a bounded document with hostile text
    const hostile: BlockDocument = {
      format: "block-editor/v0.3",
      blocks: [
        {
          id: "h",
          type: "heading",
          attrs: { level: 2 },
          content: [{ kind: "text", text: "<script>alert(1)</script>", marks: [] }],
        },
      ],
    }

    // When static projections are requested
    const outline = readOutline(hostile, { maxBlocks: 10, maxText: 100 })
    const html = exportHtml(hostile, { maxBlocks: 10, maxText: 100 })
    const markdown = exportMarkdown(hostile, { maxBlocks: 10, maxText: 100 })

    // Then text is bounded, escaped, and losses are explicit
    expect(outline.items).toHaveLength(1)
    expect(html.output).not.toContain("<script>")
    expect(markdown.losses).toEqual([])
  })
})

describe("extension registry", () => {
  it("rejects missing dependencies, conflicts, and unbounded normalizers", () => {
    // Given a registry with one base capability
    const registry = createRegistry([
      { name: "base", provides: ["paragraph"], requires: [], conflicts: [] },
    ])

    // When invalid extensions are checked, Then each contract is rejected honestly
    expect(
      registry.check({ name: "table", provides: ["table"], requires: ["grid"], conflicts: [] })
        .kind,
    ).toBe("missing_dependency")
    expect(
      registry.check({ name: "other", provides: ["paragraph"], requires: [], conflicts: ["base"] })
        .kind,
    ).toBe("conflict")
    expect(() => registry.normalize(documentFixture, { maxBlocks: 1 })).toThrowError(/bound/i)
  })
})

describe("ProseMirror ownership and lock filter", () => {
  it("keeps unknown payloads lossless through the ProseMirror opaque fallback", () => {
    // Given a document with a vendor block unknown to the active schema
    const state = createEditorState({ document: snapshotToPm(documentFixture), readonly: false })

    // When unrelated supported content lives in the same EditorState
    const snapshot = pmToSnapshot(state.doc)

    // Then the vendor block returns byte-for-byte equivalent JSON data
    expect(snapshot.blocks[1]).toEqual(documentFixture.blocks[1])
  })

  it("rejects a transaction that deletes a locked block", () => {
    // Given a ProseMirror document containing a locked block
    const locked: BlockDocument = {
      format: "block-editor/v0.3",
      blocks: [{ id: "locked", type: "paragraph", attrs: {}, content: [], locked: true }],
    }
    const state = createEditorState({ document: snapshotToPm(locked), readonly: false })

    // When a destructive transaction crosses that block
    const result = state.applyTransaction(state.tr.delete(0, state.doc.content.size))

    // Then the filter rejects the transaction and retains the locked identity
    expect(result.transactions).toHaveLength(0)
    expect(pmToSnapshot(result.state.doc).blocks[0]?.id).toBe("locked")
  })
})

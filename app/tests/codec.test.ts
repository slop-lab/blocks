import { describe, expect, it } from "vitest"
import { decodeDocument, encodeDocument } from "../src/core/codec"
import { createRegistry } from "../src/core/registry"
import type { BlockDocument } from "../src/core/types"
import { pmToSnapshot, snapshotToPm } from "../src/pm/snapshot"

describe("lossless v0.3 codec", () => {
  it("preserves schema versions and extension payloads at every object boundary", () => {
    const input = {
      format: "block-editor/v0.3",
      schemaVersion: 17,
      vendorDocument: { mode: "canvas" },
      blocks: [
        {
          id: "known",
          type: "paragraph",
          schemaVersion: "vendor-2",
          attrs: { tone: "quiet" },
          content: [{ kind: "text", text: "hello", marks: [], vendorInline: true }],
          vendorBlock: { revision: 4 },
        },
      ],
    }

    const output = JSON.parse(encodeDocument(decodeDocument(input)))

    expect(output).toEqual(input)
  })

  it("uses an opaque block when an inline or mark cannot be represented safely", () => {
    const input: BlockDocument = {
      format: "block-editor/v0.3",
      blocks: [
        {
          id: "unsafe-inline",
          type: "paragraph",
          attrs: { vendor: 1 },
          content: [{ kind: "opaque", raw: { widget: "mention" } }],
        },
        {
          id: "unsafe-mark",
          type: "paragraph",
          attrs: {},
          content: [{ kind: "text", text: "marked", marks: [{ type: "vendor.highlight" }] }],
        },
      ],
    }

    const output = pmToSnapshot(snapshotToPm(input))

    expect(output).toEqual(input)
  })

  it("preserves known marks and their attributes through ProseMirror", () => {
    const input: BlockDocument = {
      format: "block-editor/v0.3",
      blocks: [
        {
          id: "link",
          type: "paragraph",
          attrs: { custom: [1, 2] },
          content: [
            {
              kind: "text",
              text: "linked",
              marks: [{ type: "link", attrs: { href: "/docs", tracking: "kept" } }],
            },
          ],
        },
      ],
    }

    const pm = snapshotToPm(input)

    expect(pm.child(0).type.name).toBe("paragraph")
    expect(pmToSnapshot(pm)).toEqual(input)
  })

  it("round-trips empty text by making the containing block opaque", () => {
    const input: BlockDocument = {
      format: "block-editor/v0.3",
      blocks: [
        {
          id: "empty-text",
          type: "paragraph",
          attrs: {},
          content: [{ kind: "text", text: "", marks: [] }],
        },
      ],
    }

    const pm = snapshotToPm(input)

    expect(pm.child(0).type.name).toBe("opaque")
    expect(pmToSnapshot(pm)).toEqual(input)
  })

  it("round-trips content attached to a leaf task card through opaque fallback", () => {
    const input: BlockDocument = {
      format: "block-editor/v0.3",
      blocks: [
        {
          id: "task-content",
          type: "task_card",
          attrs: { taskId: "T-1" },
          content: [{ kind: "text", text: "must not disappear", marks: [] }],
        },
      ],
    }

    const pm = snapshotToPm(input)

    expect(pm.child(0).type.name).toBe("opaque")
    expect(pmToSnapshot(pm)).toEqual(input)
  })

  it("round-trips marks forbidden by code blocks through opaque fallback", () => {
    const input: BlockDocument = {
      format: "block-editor/v0.3",
      blocks: [
        {
          id: "marked-code",
          type: "code",
          attrs: {},
          content: [{ kind: "text", text: "const value = 1", marks: [{ type: "strong" }] }],
        },
      ],
    }

    const pm = snapshotToPm(input)

    expect(pm.child(0).type.name).toBe("opaque")
    expect(pmToSnapshot(pm)).toEqual(input)
  })
})

describe("normalizer registry", () => {
  const document: BlockDocument = {
    format: "block-editor/v0.3",
    blocks: [{ id: "a", type: "paragraph", attrs: {}, content: [] }],
  }

  it("rejects invalid initial dependencies and conflicts", () => {
    expect(() =>
      createRegistry([{ name: "tables", provides: ["table"], requires: ["grid"], conflicts: [] }]),
    ).toThrowError(/dependency/i)
    expect(() =>
      createRegistry([
        { name: "one", provides: ["paragraph"], requires: [], conflicts: ["two"] },
        { name: "two", provides: ["quote"], requires: [], conflicts: [] },
      ]),
    ).toThrowError(/conflict/i)
  })

  it("runs normalizers to a fixed point and rejects oscillation", () => {
    const fixed = createRegistry([
      {
        name: "version",
        provides: ["versioned"],
        requires: [],
        conflicts: [],
        normalize: (current) =>
          current.schemaVersion === 1 ? current : { ...current, schemaVersion: 1 },
      },
    ])
    const oscillating = createRegistry([
      {
        name: "toggle",
        provides: ["toggle"],
        requires: [],
        conflicts: [],
        normalize: (current) => ({
          ...current,
          schemaVersion: current.schemaVersion === 1 ? 2 : 1,
        }),
      },
    ])

    expect(fixed.normalize(document, { maxBlocks: 2, maxPasses: 4 }).schemaVersion).toBe(1)
    expect(() => oscillating.normalize(document, { maxBlocks: 2, maxPasses: 4 })).toThrowError(
      /oscillat/i,
    )
  })

  it("detects oscillation hidden inside one full normalizer pass", () => {
    const registry = createRegistry([
      {
        name: "add-phase",
        provides: ["phase-added"],
        requires: [],
        conflicts: [],
        normalize: (current) => ({ ...current, phase: "intermediate" }),
      },
      {
        name: "remove-phase",
        provides: ["phase-removed"],
        requires: [],
        conflicts: [],
        normalize: (current) => ({ ...current, phase: undefined }),
      },
    ])

    expect(() => registry.normalize(document, { maxBlocks: 2, maxPasses: 4 })).toThrowError(
      /oscillat/i,
    )
  })

  it("checks the block bound after each individual normalizer", () => {
    const registry = createRegistry([
      {
        name: "expand",
        provides: ["expanded"],
        requires: [],
        conflicts: [],
        normalize: (current) => ({
          ...current,
          blocks: [...current.blocks, { id: "b", type: "paragraph", attrs: {}, content: [] }],
        }),
      },
      {
        name: "contract",
        provides: ["contracted"],
        requires: [],
        conflicts: [],
        normalize: (current) => ({ ...current, blocks: current.blocks.slice(0, 1) }),
      },
    ])

    expect(() => registry.normalize(document, { maxBlocks: 1, maxPasses: 4 })).toThrowError(
      /bound/i,
    )
  })
})

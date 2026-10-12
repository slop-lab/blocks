import {
  canonicalSelection,
  cloneForest,
  flattenTree,
  moveForest,
  type TreeNode,
} from "@block-editor/containers"
import {
  BLOCK_CLIPBOARD_MIME,
  BlockSelection,
  type ClipboardEnvelope,
  ContentHistory,
  decodeBlockClipboard,
  encodeBlockClipboard,
  routeCut,
} from "@block-editor/interactions"
import { describe, expect, it } from "vitest"

type TestNode = TreeNode & {
  readonly label: string
  readonly referenceId?: string
}

const tree: readonly TestNode[] = [
  {
    id: "section-a",
    label: "A",
    children: [
      { id: "a-1", label: "A1", children: [] },
      { id: "a-2", label: "A2", children: [] },
    ],
  },
  { id: "section-b", label: "B", children: [] },
  { id: "locked", label: "Locked", locked: true, children: [] },
]

describe("recursive container operations", () => {
  it("Given nested blocks, When selection contains an ancestor and descendant, Then it keeps only the ancestor", () => {
    expect(canonicalSelection(tree, ["a-2", "section-a", "section-b"])).toEqual([
      "section-a",
      "section-b",
    ])
  })

  it("Given selected siblings, When they move into a container, Then IDs and order remain stable", () => {
    const moved = moveForest(tree, ["section-b"], { parentId: "section-a", index: 1 })

    expect(moved.kind).toBe("moved")
    if (moved.kind !== "moved") return
    expect(flattenTree(moved.forest).map(({ node, depth }) => [node.id, depth])).toEqual([
      ["section-a", 0],
      ["a-1", 1],
      ["section-b", 1],
      ["a-2", 1],
      ["locked", 0],
    ])
  })

  it("Given a container, When it is moved into its descendant, Then the whole move is rejected", () => {
    expect(moveForest(tree, ["section-a"], { parentId: "a-1", index: 0 })).toEqual({
      kind: "rejected",
      reason: "descendant-target",
    })
  })

  it("Given a recursive clone, When IDs and references are remapped, Then every local identity is fresh", () => {
    let sequence = 0
    const source = tree[0]
    if (source === undefined) throw new TypeError("Missing section fixture")
    const cloned = cloneForest(
      [{ ...source, referenceId: "a-1" }],
      () => `copy-${++sequence}`,
      (node, ids) => {
        const referenceId = node["referenceId"]
        return typeof referenceId === "string"
          ? { ...node, referenceId: ids.get(referenceId) ?? referenceId }
          : node
      },
    )

    expect(cloned[0]?.id).toBe("copy-1")
    expect(cloned[0]?.children[0]?.id).toBe("copy-2")
    expect(cloned[0]?.["referenceId"]).toBe("copy-2")
  })
})

describe("block interaction contracts", () => {
  it("Given visible nested blocks, When replace, range, and toggle intents run, Then selection follows visible order", () => {
    const visible = flattenTree(tree).map(({ node }) => node.id)
    const selection = new BlockSelection()

    selection.apply({ kind: "replace", id: "a-1" }, visible)
    selection.apply({ kind: "range", id: "section-b" }, visible)
    selection.apply({ kind: "toggle", id: "a-2" }, visible)

    expect(selection.value).toEqual(["a-1", "section-b"])
    expect(selection.anchor).toBe("a-1")
    expect(selection.focus).toBe("a-2")
  })

  it("Given removed visible blocks, When selection reconciles, Then stale IDs and anchors are pruned", () => {
    const selection = new BlockSelection()
    selection.apply({ kind: "replace", id: "a-1" }, ["a-1", "a-2"])
    selection.apply({ kind: "range", id: "a-2" }, ["a-1", "a-2"])

    selection.reconcile(["a-2", "section-b"])

    expect(selection.value).toEqual(["a-2"])
    expect(selection.anchor).toBeNull()
    expect(selection.focus).toBe("a-2")
  })

  it("Given selected blocks, When copied, Then safe versioned JSON and plaintext are produced without HTML", () => {
    const selected = tree[1]
    if (selected === undefined) throw new TypeError("Missing clipboard fixture")
    const envelope: ClipboardEnvelope<TestNode> = {
      namespace: "workspace-a",
      blocks: [selected],
      externalReferences: ["page-elsewhere"],
    }
    const encoded = encodeBlockClipboard(envelope, (blocks) =>
      blocks.map((block) => block.label).join("\n"),
    )

    expect(encoded.mime).toBe(BLOCK_CLIPBOARD_MIME)
    expect(encoded.html).toBeUndefined()
    expect(encoded.text).toBe("B")
    expect(decodeBlockClipboard(encoded.json)).toEqual({ kind: "valid", envelope })
  })

  it("Given invalid clipboard JSON, When decoded, Then it returns a diagnostic and executes nothing", () => {
    expect(decodeBlockClipboard('{"version":99,"blocks":[]}')).toEqual({
      kind: "invalid",
      reason: "unsupported-version",
    })
  })

  it("Given a failed clipboard write, When cut is routed, Then selected nodes remain", async () => {
    let removed = false
    const cut = routeCut({
      policy: "remove-after-write",
      write: async () => {
        throw new DOMException("Denied", "NotAllowedError")
      },
      remove: () => {
        removed = true
      },
      markPending: () => {},
    })

    expect(cut.consumed).toBe(true)
    expect(await cut.completion).toEqual({ kind: "write-failed" })
    expect(removed).toBe(false)
  })

  it("Given a host-deferred cut policy, When routed, Then ownership transfers only after clipboard write", async () => {
    const events: string[] = []
    const cut = routeCut({
      policy: "host-deferred",
      write: async () => {
        events.push("written")
      },
      remove: () => events.push("removed"),
      markPending: () => events.push("pending"),
    })

    expect(events).toEqual(["written"])
    expect(await cut.completion).toEqual({ kind: "deferred" })
    expect(events).toEqual(["written", "pending"])
  })

  it("Given content and selection history, When selection-only changes occur, Then undo restores the last content batch", () => {
    const history = new ContentHistory({ content: "A", selection: ["a"] })
    history.record({ content: "AB", selection: ["b"] }, true)
    history.record({ content: "AB", selection: ["c"] }, false)

    expect(history.undo()).toEqual({ content: "A", selection: ["a"] })
    expect(history.redo()).toEqual({ content: "AB", selection: ["c"] })
  })
})

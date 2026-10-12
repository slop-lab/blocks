import {
  canonicalSelection,
  cloneForest,
  flattenTree,
  moveForest,
  planTreeWrap,
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
  it("Given contiguous siblings, When wrapping is planned, Then the exact range is returned", () => {
    const plan = planTreeWrap(tree, ["a-1", "a-2"])

    expect(plan).toEqual({
      kind: "exact",
      selectedIds: ["a-1", "a-2"],
      coveredIds: ["a-1", "a-2"],
      additionalIds: [],
      parentPath: ["section-a"],
      range: { from: 0, to: 2 },
      rootIds: ["a-1", "a-2"],
    })
  })

  it("Given sibling gaps, When wrapping is planned, Then intervening subtrees are explicit", () => {
    const forest: readonly TreeNode[] = [
      { id: "a", children: [] },
      { id: "b", children: [{ id: "b-child", children: [] }] },
      { id: "c", children: [] },
    ]

    expect(planTreeWrap(forest, ["a", "c"])).toEqual({
      kind: "expanded",
      selectedIds: ["a", "c"],
      coveredIds: ["a", "b", "b-child", "c"],
      additionalIds: ["b", "b-child"],
      parentPath: [],
      range: { from: 0, to: 3 },
      rootIds: ["a", "b", "c"],
    })
  })

  it("Given selections at different depths, When wrapping is planned, Then their minimal connected cover is returned", () => {
    const forest: readonly TreeNode[] = [
      {
        id: "left",
        children: [
          { id: "left-a", children: [] },
          { id: "left-b", children: [] },
        ],
      },
      { id: "middle", children: [] },
      { id: "right", children: [{ id: "right-a", children: [] }] },
    ]

    const plan = planTreeWrap(forest, ["left-b", "right-a"])

    expect(plan.kind).toBe("expanded")
    if (plan.kind !== "expanded") return
    expect(plan.parentPath).toEqual([])
    expect(plan.rootIds).toEqual(["left", "middle", "right"])
    expect(plan.coveredIds).toEqual(["left", "left-a", "left-b", "middle", "right", "right-a"])
    expect(plan.additionalIds).toEqual(["left", "left-a", "middle", "right"])
  })

  it("Given an ancestor and descendant, When wrapping is planned, Then the ancestor subtree is one exact root", () => {
    const plan = planTreeWrap(tree, ["section-a", "a-2"])

    expect(plan.kind).toBe("exact")
    if (plan.kind !== "exact") return
    expect(plan.selectedIds).toEqual(["section-a"])
    expect(plan.coveredIds).toEqual(["section-a", "a-1", "a-2"])
    expect(plan.additionalIds).toEqual([])
    expect(plan.rootIds).toEqual(["section-a"])
  })

  it("Given invalid or protected input, When wrapping is planned, Then no partial plan is returned", () => {
    const mixed: readonly TreeNode[] = [
      { id: "one", boundary: "page", children: [] },
      { id: "two", boundary: "source", children: [] },
    ]
    const cyclic = { id: "cycle", children: [] as readonly TreeNode[] }
    Object.defineProperty(cyclic, "children", { value: [cyclic] })

    expect(planTreeWrap(tree, [])).toEqual({ kind: "invalid", reason: "empty-selection" })
    expect(planTreeWrap(tree, ["missing"])).toEqual({
      kind: "invalid",
      reason: "missing-id",
      ids: ["missing"],
    })
    expect(planTreeWrap(tree, ["section-b", "locked"])).toEqual({
      kind: "invalid",
      reason: "locked",
      ids: ["locked"],
    })
    expect(planTreeWrap(mixed, ["one", "two"])).toEqual({
      kind: "invalid",
      reason: "mixed-boundary",
      boundaries: ["page", "source"],
    })
    expect(planTreeWrap([cyclic], ["cycle"])).toEqual({
      kind: "invalid",
      reason: "cycle",
      ids: ["cycle"],
    })
  })

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

  it("Given a noncontiguous selection, When Shift targets from the last focus, Then the range adds or removes by target membership", () => {
    const visible = ["a", "b", "c", "d", "e"]
    const selection = new BlockSelection()
    selection.apply({ kind: "replace", id: "b" }, visible)
    selection.apply({ kind: "toggle", id: "e" }, visible)

    selection.apply({ kind: "range", id: "c" }, visible)
    expect(selection.value).toEqual(["b", "c", "d", "e"])
    expect(selection.focus).toBe("c")

    selection.apply({ kind: "range", id: "e" }, visible)
    expect(selection.value).toEqual(["b"])
    expect(selection.focus).toBe("e")
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

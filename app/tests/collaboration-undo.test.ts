// @vitest-environment jsdom

import { baseKeymap } from "prosemirror-commands"
import { EditorState, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { describe, expect, it, vi } from "vitest"
import { initProseMirrorDoc, undo, ySyncPlugin, ySyncPluginKey, yUndoPlugin } from "y-prosemirror"
import * as Y from "yjs"
import type { BlockDocument } from "../src/core/types"
import { createInitialCollaborationUpdate } from "../src/features/collaboration/CollaborationBinding"
import { createWorkspaceProfile } from "../src/features/workspace/workspace-editor-model"
import { duplicateBlock } from "../src/pm/commands"
import { createIdentityPlugin, createLockedBlockPlugin } from "../src/pm/editor"
import { editorSchema } from "../src/pm/schema"

const createView = (doc: Y.Doc, enforceLocks = false): EditorView => {
  const fragment = doc.getXmlFragment("prosemirror")
  const initial = initProseMirrorDoc(fragment, editorSchema)
  return new EditorView(document.createElement("div"), {
    state: EditorState.create({
      schema: editorSchema,
      doc: initial.doc,
      plugins: [
        ySyncPlugin(fragment, { mapping: initial.mapping }),
        yUndoPlugin(),
        ...(enforceLocks
          ? [
              createLockedBlockPlugin(
                (transaction) => transaction.getMeta(ySyncPluginKey)?.isChangeOrigin === true,
              ),
            ]
          : []),
        createIdentityPlugin((transactions) =>
          transactions.some(
            (transaction) =>
              transaction.docChanged &&
              transaction.getMeta(ySyncPluginKey)?.isChangeOrigin !== true,
          ),
        ),
      ],
    }),
  })
}

describe("collaboration history", () => {
  it.each([
    ["start", 0],
    ["middle", 2],
    ["end", 4],
  ])(
    "assigns unique nested IDs when Enter splits a quote paragraph at the %s",
    (_label, offset) => {
      const profile = createWorkspaceProfile(0)
      const quote = profile.schema.nodes["container_quote"]
      const paragraph = profile.schema.nodes["paragraph"]
      if (quote === undefined || paragraph === undefined)
        throw new TypeError("Workspace quote schema is incomplete")
      const document = profile.schema.topNodeType.create(undefined, [
        quote.create({ id: "outer-quote", locked: false }, [
          paragraph.create({ id: "quote-text", locked: false }, profile.schema.text("abcd")),
        ]),
      ])
      let state = EditorState.create({
        schema: profile.schema,
        doc: document,
        selection: TextSelection.create(document, 2 + offset),
        plugins: [createIdentityPlugin()],
      })

      const enter = baseKeymap["Enter"]
      if (enter === undefined) throw new TypeError("Base Enter command is missing")
      expect(
        enter(state, (transaction) => {
          state = state.apply(transaction)
        }),
      ).toBe(true)

      const ids: string[] = []
      state.doc.descendants((node) => {
        const id = node.attrs["id"]
        if (typeof id === "string") ids.push(id)
        return true
      })
      expect(state.doc.childCount).toBe(1)
      expect(state.doc.firstChild?.type.name).toBe("container_quote")
      expect(state.doc.firstChild?.childCount).toBe(2)
      expect(ids[0]).toBe("outer-quote")
      expect(ids[1]).toBe("quote-text")
      expect(ids[2]).toMatch(/[0-9a-f-]{36}/u)
      expect(new Set(ids).size).toBe(ids.length)
    },
  )

  it("keeps a remote edit when the local client undoes its own edit", () => {
    const firstDoc = new Y.Doc()
    const firstFragment = firstDoc.getXmlFragment("prosemirror")
    firstFragment.insert(0, [new Y.XmlElement("paragraph")])
    const secondDoc = new Y.Doc()
    Y.applyUpdate(secondDoc, Y.encodeStateAsUpdate(firstDoc), "initial")
    firstDoc.on("update", (update, origin) => {
      if (origin !== secondDoc) Y.applyUpdate(secondDoc, update, firstDoc)
    })
    secondDoc.on("update", (update, origin) => {
      if (origin !== firstDoc) Y.applyUpdate(firstDoc, update, secondDoc)
    })
    const firstView = createView(firstDoc)
    const secondView = createView(secondDoc)

    firstView.dispatch(firstView.state.tr.insertText("local", 1))
    secondView.dispatch(
      secondView.state.tr.insertText("remote", secondView.state.doc.content.size - 1),
    )
    expect(firstView.state.doc.textContent).toContain("remote")
    expect(undo(firstView.state)).toBe(true)
    expect(firstView.state.doc.textContent).toBe("remote")
    expect(secondView.state.doc.textContent).toBe("remote")

    firstView.destroy()
    secondView.destroy()
    firstDoc.destroy()
    secondDoc.destroy()
  })

  it("assigns a stable ID to a split block and converges concurrent text edits", () => {
    const randomId = vi.spyOn(crypto, "randomUUID")
    const seed: BlockDocument = {
      format: "block-editor/v0.3",
      blocks: [
        {
          id: "stable-paragraph",
          type: "paragraph",
          attrs: {},
          content: [{ kind: "text", text: "abcd", marks: [] }],
        },
      ],
    }
    const firstDoc = new Y.Doc()
    const secondDoc = new Y.Doc()
    const initial = createInitialCollaborationUpdate(seed)
    Y.applyUpdate(firstDoc, initial)
    Y.applyUpdate(secondDoc, initial)
    const firstUpdates: Uint8Array[] = []
    const secondUpdates: Uint8Array[] = []
    firstDoc.on("update", (update) => firstUpdates.push(update))
    secondDoc.on("update", (update) => secondUpdates.push(update))
    const firstView = createView(firstDoc)
    const secondView = createView(secondDoc)

    firstView.dispatch(firstView.state.tr.insertText("A", 3).split(4))
    duplicateBlock(firstView.state, firstView.dispatch)
    secondView.dispatch(secondView.state.tr.insertText("B", 3))
    for (const update of firstUpdates) Y.applyUpdate(secondDoc, update)
    for (const update of secondUpdates) Y.applyUpdate(firstDoc, update)

    expect(firstView.state.doc.eq(secondView.state.doc)).toBe(true)
    const ids: string[] = []
    firstView.state.doc.forEach((node) => {
      ids.push(node.attrs["id"] as string)
    })
    expect(ids).toHaveLength(3)
    expect(ids[0]).toBe("stable-paragraph")
    expect(ids[1]).toMatch(/[0-9a-f-]{36}/)
    expect(ids[2]).toMatch(/[0-9a-f-]{36}/)
    expect(new Set(ids).size).toBe(ids.length)
    expect(randomId).toHaveBeenCalledTimes(2)
    expect(firstView.state.doc.textContent).toContain("A")
    expect(firstView.state.doc.textContent).toContain("B")

    firstView.destroy()
    secondView.destroy()
    firstDoc.destroy()
    secondDoc.destroy()
    randomId.mockRestore()
  })

  it("accepts a remote locked-block update while rejecting the same local edit", () => {
    const seed: BlockDocument = {
      format: "block-editor/v0.3",
      blocks: [
        {
          id: "locked-policy",
          type: "paragraph",
          attrs: {},
          content: [{ kind: "text", text: "policy", marks: [] }],
          locked: true,
        },
      ],
    }
    const protectedDoc = new Y.Doc()
    const remoteDoc = new Y.Doc()
    const initial = createInitialCollaborationUpdate(seed)
    Y.applyUpdate(protectedDoc, initial)
    Y.applyUpdate(remoteDoc, initial)
    protectedDoc.on("update", (update, origin) => {
      if (origin !== remoteDoc) Y.applyUpdate(remoteDoc, update, protectedDoc)
    })
    remoteDoc.on("update", (update, origin) => {
      if (origin !== protectedDoc) Y.applyUpdate(protectedDoc, update, remoteDoc)
    })
    const protectedView = createView(protectedDoc, true)
    const remoteView = createView(remoteDoc)

    protectedView.dispatch(protectedView.state.tr.insertText("local-", 1))
    expect(protectedView.state.doc.textContent).toBe("policy")
    remoteView.dispatch(remoteView.state.tr.insertText("remote-", 1))
    expect(protectedView.state.doc.textContent).toBe("remote-policy")

    protectedView.destroy()
    remoteView.destroy()
    protectedDoc.destroy()
    remoteDoc.destroy()
  })
})

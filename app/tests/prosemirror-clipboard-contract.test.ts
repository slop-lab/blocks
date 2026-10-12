// @vitest-environment jsdom

import { BLOCK_CLIPBOARD_MIME, type ClipboardEnvelope } from "@block-editor/interactions"
import { TextSelection } from "prosemirror-state"
import { afterEach, expect, it } from "vitest"
import {
  cleanupSelectionViews,
  clipboardEvent,
  createSelectionView,
} from "./prosemirror-selection-fixture"

afterEach(cleanupSelectionViews)

it("lets native text copy proceed without the block MIME from an earlier block selection", () => {
  const { view, controller } = createSelectionView()
  controller.replace(["first"])
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 4)))
  controller.activateText()
  const copy = clipboardEvent("copy")

  view.dom.dispatchEvent(copy.event)

  expect(copy.data.has(BLOCK_CLIPBOARD_MIME)).toBe(false)
  expect(copy.data.has("text/plain")).toBe(true)
})

it("rejects every schema-invalid clipboard block before invoking paste policy", () => {
  let policyCalls = 0
  const { view } = createSelectionView({
    clipboard: {
      namespace: "selection-test",
      cut: "remove-after-write",
      paste: () => {
        policyCalls += 1
        return "clone"
      },
    },
  })
  const paste = clipboardEvent("paste", {
    [BLOCK_CLIPBOARD_MIME]: JSON.stringify({
      version: 1,
      namespace: "external",
      blocks: [
        {
          type: "paragraph",
          attrs: { id: "invalid", locked: false },
          content: [{ type: "paragraph", attrs: { id: "nested", locked: false } }],
        },
      ],
      externalReferences: [],
    }),
  })

  view.dom.dispatchEvent(paste.event)

  expect(policyCalls).toBe(0)
  expect(paste.event.defaultPrevented).toBe(false)
})

it("derives reference metadata from validated nodes before the policy hook", () => {
  const policyEnvelopes: ClipboardEnvelope[] = []
  const referenceEnvelopes: ClipboardEnvelope[] = []
  const { view } = createSelectionView({
    clipboard: {
      namespace: "selection-test",
      cut: "remove-after-write",
      paste: (envelope) => {
        policyEnvelopes.push(envelope)
        return "link"
      },
    },
    referenceAttrsForNode: () => ["originalType"],
    onReferencePaste: (envelope) => referenceEnvelopes.push(envelope),
  })
  const paste = clipboardEvent("paste", {
    [BLOCK_CLIPBOARD_MIME]: JSON.stringify({
      version: 1,
      namespace: "external",
      blocks: [{ type: "opaque", attrs: { id: "copy", raw: "{}", originalType: "actual" } }],
      externalReferences: ["forged"],
    }),
  })

  view.dom.dispatchEvent(paste.event)

  expect(policyEnvelopes[0]?.externalReferences).toEqual(["actual"])
  expect(referenceEnvelopes[0]).toBe(policyEnvelopes[0])
})

it("does not delete a captured cut intent after its document changes", async () => {
  const unavailable: string[] = []
  const { view, controller } = createSelectionView({
    onUnavailable: (message) => unavailable.push(message),
  })
  controller.replace(["first"])
  const cut = clipboardEvent("cut")

  view.dom.dispatchEvent(cut.event)
  view.dispatch(view.state.tr.insertText("changed", 2))
  await Promise.resolve()
  await Promise.resolve()

  expect(view.state.doc.firstChild?.attrs["id"]).toBe("first")
  expect(unavailable).toContain("문서가 변경되어 잘라내기를 취소했습니다.")
})

it("rejects delayed cut deletion when the host model version changes", async () => {
  let version = 4
  const { view, controller } = createSelectionView({
    interactionContext: () => ({ modelId: "document-a", epoch: 2, version }),
  })
  controller.replace(["first"])
  const cut = clipboardEvent("cut")

  view.dom.dispatchEvent(cut.event)
  version += 1
  await Promise.resolve()
  await Promise.resolve()

  expect(view.state.doc.firstChild?.attrs["id"]).toBe("first")
})

it("reports a rejected deferred-cut callback without deleting content", async () => {
  const unavailable: string[] = []
  const { view, controller } = createSelectionView({
    clipboard: {
      namespace: "selection-test",
      cut: "host-deferred",
      paste: () => "clone",
    },
    onDeferredCut: async () => {
      throw new DOMException("Rejected", "AbortError")
    },
    onUnavailable: (message) => unavailable.push(message),
  })
  controller.replace(["first"])

  view.dom.dispatchEvent(clipboardEvent("cut").event)
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()

  expect(view.state.doc.firstChild?.attrs["id"]).toBe("first")
  expect(unavailable).toContain("호스트가 잘라내기 요청을 완료하지 못했습니다.")
})

// @vitest-environment jsdom

import { BLOCK_CLIPBOARD_MIME } from "@block-editor/interactions"
import { afterEach, expect, it } from "vitest"
import {
  cleanupSelectionViews,
  clipboardEvent,
  createSelectionView,
} from "./prosemirror-selection-fixture"

afterEach(cleanupSelectionViews)

const contextControl = (label: string): HTMLButtonElement => {
  const control = document.createElement("button")
  control.textContent = label
  document.body.append(control)
  return control
}

it("routes copy and cut from a declared context control to the active block selection", async () => {
  const menuItem = contextControl("block menu item")
  const { view, controller } = createSelectionView({
    isContextTarget: (target) => menuItem.contains(target),
  })
  controller.replace(["first"])
  const copy = clipboardEvent("copy")

  menuItem.dispatchEvent(copy.event)

  expect(copy.data.has(BLOCK_CLIPBOARD_MIME)).toBe(true)
  expect(copy.data.get("text/plain")).toBe("First")

  const cut = clipboardEvent("cut")
  menuItem.dispatchEvent(cut.event)
  await Promise.resolve()
  await Promise.resolve()

  expect(view.state.doc.firstChild?.attrs["id"]).toBe("second")
})

it("routes paste from a declared context control exactly once", () => {
  const menuItem = contextControl("block menu item")
  const { view, controller } = createSelectionView({
    isContextTarget: (target) => menuItem.contains(target),
  })
  controller.replace(["first"])
  const paste = clipboardEvent("paste", {
    [BLOCK_CLIPBOARD_MIME]: JSON.stringify({
      version: 1,
      namespace: "selection-test",
      blocks: [{ type: "paragraph", attrs: { id: "copied", locked: false } }],
      externalReferences: [],
    }),
  })

  menuItem.dispatchEvent(paste.event)

  expect(view.state.doc.childCount).toBe(5)
  const ids: string[] = []
  view.state.doc.forEach((node) => {
    ids.push(String(node.attrs["id"]))
  })
  expect(ids.filter((id) => id === "copied")).toHaveLength(0)
  expect(new Set(ids).size).toBe(ids.length)
})

it("leaves clipboard commands native inside text inputs in a declared context", async () => {
  const toolbar = document.createElement("div")
  const input = document.createElement("input")
  input.value = "https://example.com"
  toolbar.append(input)
  document.body.append(toolbar)
  const { view, controller } = createSelectionView({
    isContextTarget: (target) => toolbar.contains(target),
  })
  controller.replace(["first"])
  const copy = clipboardEvent("copy")
  const cut = clipboardEvent("cut")

  input.dispatchEvent(copy.event)
  input.dispatchEvent(cut.event)
  await Promise.resolve()
  await Promise.resolve()

  expect(copy.event.defaultPrevented).toBe(false)
  expect(copy.data.has(BLOCK_CLIPBOARD_MIME)).toBe(false)
  expect(cut.event.defaultPrevented).toBe(false)
  expect(view.state.doc.firstChild?.attrs["id"]).toBe("first")
})

it("does not capture a declared context target from an inactive selection", () => {
  const menu = contextControl("inactive menu")
  let active = true
  const selection = createSelectionView({
    isActive: () => active,
    isContextTarget: (target) => menu.contains(target),
  })
  selection.controller.replace(["first"])
  active = false
  const copy = clipboardEvent("copy")

  menu.dispatchEvent(copy.event)

  expect(copy.data.has(BLOCK_CLIPBOARD_MIME)).toBe(false)
})

it("keeps declared controls owner-specific across simultaneously active scopes", () => {
  const firstMenu = contextControl("first menu")
  const secondMenu = contextControl("second menu")
  const first = createSelectionView({
    isActive: () => true,
    isContextTarget: (target) => firstMenu.contains(target),
  })
  const second = createSelectionView({
    isActive: () => true,
    isContextTarget: (target) => secondMenu.contains(target),
  })
  first.controller.replace(["first"])
  second.controller.replace(["second"])
  const firstCopy = clipboardEvent("copy")

  firstMenu.dispatchEvent(firstCopy.event)

  expect(firstCopy.data.get("text/plain")).toBe("First")

  const secondCopy = clipboardEvent("copy")
  secondMenu.dispatchEvent(secondCopy.event)

  expect(secondCopy.data.get("text/plain")).toBe("Second")
})

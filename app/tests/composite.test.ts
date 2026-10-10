// @vitest-environment jsdom

import { TextSelection } from "prosemirror-state"
import { CellSelection, goToNextCell, TableMap } from "prosemirror-tables"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createAttachmentFactory } from "../src/features/composite/attachments"
import {
  createCompositeDraftWriter,
  loadCompositeWorkspace,
  saveCompositeDraft,
  saveCompositeWorkspace,
} from "../src/features/composite/persistence"
import {
  compositeSchema,
  createCompositeEditorState,
  createCompositeSnapshot,
  migrateCompositeSnapshot,
  tableCommands,
} from "../src/features/composite/profile"

const cellPositions = (document: ReturnType<typeof compositeSchema.nodeFromJSON>) => {
  const positions: number[] = []
  document.descendants((node, position) => {
    if (node.type.spec["tableRole"] === "cell" || node.type.spec["tableRole"] === "header_cell")
      positions.push(position)
  })
  return positions
}

class CountingStorage implements Storage {
  readonly values = new Map<string, string>()
  writes = 0

  get length() {
    return this.values.size
  }
  clear() {
    this.values.clear()
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  setItem(key: string, value: string) {
    this.writes += 1
    this.values.set(key, value)
  }
}

afterEach(() => vi.useRealTimers())

describe("composite schema profile", () => {
  it("migrates v1 into the native v2 document and explicitly resets history", () => {
    const legacy = {
      schemaVersion: 1 as const,
      title: "출시 계획",
      caption: "결정 기록",
      code: "const release = true",
    }

    const migration = migrateCompositeSnapshot(legacy)

    expect(migration.historyReset).toBe(true)
    expect(migration.snapshot.schemaVersion).toBe(2)
    expect(migration.snapshot.code).toBe(legacy.code)
    expect(compositeSchema.nodeFromJSON(migration.snapshot.document).textContent).toContain(
      legacy.title,
    )
  })

  it("round-trips table JSON without losing the stable top-level block ID", () => {
    const snapshot = createCompositeSnapshot()
    const document = compositeSchema.nodeFromJSON(snapshot.document)

    const roundTrip = compositeSchema.nodeFromJSON(document.toJSON())

    expect(roundTrip.toJSON()).toEqual(snapshot.document)
    expect(roundTrip.child(1).attrs["id"]).toBe("composite-table")
  })

  it("performs native cell selection, paste, row/column edits, merge, and split", () => {
    const document = compositeSchema.nodeFromJSON(createCompositeSnapshot().document)
    const positions = cellPositions(document)
    const first = positions[0]
    const second = positions[1]
    if (first === undefined || second === undefined) throw new TypeError("Fixture requires cells")
    let state = createCompositeEditorState(document)
    state = state.apply(state.tr.setSelection(CellSelection.create(state.doc, first, second)))
    const copied = state.selection.content()

    state = state.apply(state.tr.replaceSelection(copied))
    const selectedAfterPaste = cellPositions(state.doc)
    const pasteFirst = selectedAfterPaste[0]
    const pasteSecond = selectedAfterPaste[1]
    if (pasteFirst === undefined || pasteSecond === undefined)
      throw new TypeError("Pasted table requires cells")
    state = state.apply(
      state.tr.setSelection(CellSelection.create(state.doc, pasteFirst, pasteSecond)),
    )
    expect(state.selection).toBeInstanceOf(CellSelection)

    const run = (command: (typeof tableCommands)[keyof typeof tableCommands]) => {
      expect(command(state, (transaction) => (state = state.apply(transaction)))).toBe(true)
    }
    run(tableCommands.mergeCells)
    run(tableCommands.splitCell)
    run(tableCommands.addRowAfter)
    run(tableCommands.addColumnAfter)
    run(tableCommands.deleteRow)
    run(tableCommands.deleteColumn)

    const table = state.doc.child(1)
    expect(TableMap.get(table).width).toBeGreaterThan(0)
    expect(table.attrs["id"]).toBe("composite-table")
  })

  it("moves keyboard focus between native table cells", () => {
    const document = compositeSchema.nodeFromJSON(createCompositeSnapshot().document)
    const first = cellPositions(document)[0]
    if (first === undefined) throw new TypeError("Fixture requires a cell")
    let state = createCompositeEditorState(document)
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, first + 2)))
    const before = state.selection.from

    const moved = goToNextCell(1)(state, (transaction) => (state = state.apply(transaction)))

    expect(moved).toBe(true)
    expect(state.selection.from).toBeGreaterThan(before)
  })
})

describe("composite attachment factory", () => {
  it("creates independently disposable typed attachments", () => {
    const disposed: string[] = []
    const factory = createAttachmentFactory<{ readonly name: string }>((host, context) => {
      host.dataset["attachment"] = context.name
      return () => disposed.push(context.name)
    })
    const firstHost = document.createElement("div")
    const secondHost = document.createElement("div")

    const first = factory.attach(firstHost, { name: "prose" })
    const second = factory.attach(secondHost, { name: "code" })
    first.dispose()
    second.dispose()

    expect(firstHost.dataset["attachment"]).toBe("prose")
    expect(secondHost.dataset["attachment"]).toBe("code")
    expect(disposed).toEqual(["prose", "code"])
  })
})

describe("composite workspace persistence", () => {
  it("keeps draft changes across remounts without marking them saved", () => {
    const storage = window.localStorage
    storage.clear()
    const saved = createCompositeSnapshot()
    const draft = { ...saved, code: "const travelDraft = true" }

    saveCompositeWorkspace(storage, saved)
    saveCompositeDraft(storage, draft)
    const restored = loadCompositeWorkspace(storage)

    expect(restored?.saved).toEqual(saved)
    expect(restored?.draft).toEqual(draft)
  })

  it("commits the document JSON and code field as one saved version", () => {
    const storage = window.localStorage
    storage.clear()
    const base = createCompositeSnapshot()
    const editedDocument = { ...base.document, attrs: { workshop: "봄 여행" } }
    const edited = { ...base, document: editedDocument, code: "const destination = '제주'" }

    saveCompositeWorkspace(storage, edited)
    const restored = loadCompositeWorkspace(storage)

    expect(restored?.saved).toEqual(edited)
    expect(restored?.draft).toEqual(edited)
  })

  it("coalesces a typing burst into one trailing draft write", () => {
    vi.useFakeTimers()
    const storage = new CountingStorage()
    const writer = createCompositeDraftWriter(storage)
    const snapshot = createCompositeSnapshot()

    writer.schedule(() => ({ ...snapshot, code: "a" }))
    writer.schedule(() => ({ ...snapshot, code: "ab" }))
    writer.schedule(() => ({ ...snapshot, code: "abc" }))
    vi.advanceTimersByTime(599)
    expect(storage.writes).toBe(0)
    vi.advanceTimersByTime(1)

    expect(storage.writes).toBe(1)
    expect(loadCompositeWorkspace(storage)?.draft.code).toBe("abc")
  })

  it("persists an active stream at the maximum wait", () => {
    vi.useFakeTimers()
    const storage = new CountingStorage()
    const writer = createCompositeDraftWriter(storage)
    const snapshot = createCompositeSnapshot()

    for (let index = 0; index < 6; index += 1) {
      writer.schedule(() => ({ ...snapshot, code: String(index) }))
      vi.advanceTimersByTime(500)
    }

    expect(storage.writes).toBe(1)
    expect(loadCompositeWorkspace(storage)?.draft.code).toBe("5")
  })

  it("commits the freshest whole snapshot once before the debounce expires", () => {
    vi.useFakeTimers()
    const storage = new CountingStorage()
    const writer = createCompositeDraftWriter(storage)
    const snapshot = createCompositeSnapshot()
    const freshest = { ...snapshot, code: "const freshest = true" }
    writer.schedule(() => ({ ...snapshot, code: "stale" }))

    writer.commit(freshest)
    vi.advanceTimersByTime(3_000)

    expect(storage.writes).toBe(1)
    expect(loadCompositeWorkspace(storage)?.saved).toEqual(freshest)
    expect(loadCompositeWorkspace(storage)?.draft).toEqual(freshest)
  })

  it("cancels pending writes without changing the saved envelope", () => {
    vi.useFakeTimers()
    const storage = new CountingStorage()
    const snapshot = createCompositeSnapshot()
    saveCompositeWorkspace(storage, snapshot)
    const writer = createCompositeDraftWriter(storage)
    writer.schedule(() => ({ ...snapshot, code: "stale pending value" }))

    writer.cancel()
    vi.advanceTimersByTime(3_000)

    expect(storage.writes).toBe(1)
    expect(loadCompositeWorkspace(storage)?.saved).toEqual(snapshot)
  })
})

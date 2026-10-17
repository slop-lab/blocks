import { blockSelectionReconcilePlugin } from "@slop-lab/blocks-interactions/prosemirror"
import { baseKeymap } from "prosemirror-commands"
import { history, redo, undo } from "prosemirror-history"
import { keymap } from "prosemirror-keymap"
import type { NodeSpec, Node as ProseMirrorNode } from "prosemirror-model"
import { Schema } from "prosemirror-model"
import type { Command } from "prosemirror-state"
import { EditorState, Plugin } from "prosemirror-state"
import {
  addColumnAfter,
  addRowAfter,
  columnResizing,
  deleteColumn,
  deleteRow,
  deleteTable,
  goToNextCell,
  mergeCells,
  splitCell,
  tableEditing,
  tableNodes,
  toggleHeaderRow,
} from "prosemirror-tables"
import { editorSchema } from "../../pm/schema"

const tableBlockAttrs = {
  id: { default: "" },
  locked: { default: false },
  snapshotAttrs: { default: {} },
  blockExtras: { default: {} },
  snapshotType: { default: "table" },
}

const nativeTableNodes = tableNodes({
  tableGroup: "block",
  cellContent: "paragraph+",
  cellAttributes: {},
})

const tableSpec: NodeSpec = {
  ...nativeTableNodes.table,
  attrs: tableBlockAttrs,
  toDOM: (node) => [
    "table",
    { "data-block-id": node.attrs["id"], "data-composite-table": "true" },
    ["tbody", 0],
  ],
}

export const compositeSchema = new Schema({
  nodes: editorSchema.spec.nodes.append({ ...nativeTableNodes, table: tableSpec }),
  marks: editorSchema.spec.marks,
})

const ensureBlockIdentity = new Plugin({
  appendTransaction: (transactions, _oldState, newState) => {
    if (!transactions.some((transaction) => transaction.docChanged)) return null
    const ids = new Set<string>()
    let repair = newState.tr
    newState.doc.forEach((node, position) => {
      const current = node.attrs["id"]
      if (typeof current === "string" && current.length > 0 && !ids.has(current)) {
        ids.add(current)
        return
      }
      const id = crypto.randomUUID()
      ids.add(id)
      repair = repair.setNodeMarkup(position, undefined, { ...node.attrs, id })
    })
    return repair.docChanged ? repair : null
  },
})

export const tableCommands = {
  addColumnAfter,
  addRowAfter,
  deleteColumn,
  deleteRow,
  deleteTable,
  mergeCells,
  splitCell,
  toggleHeaderRow,
} as const

export const createCompositeEditorState = (document: ProseMirrorNode): EditorState =>
  EditorState.create({
    schema: compositeSchema,
    doc: document,
    plugins: [
      history(),
      ensureBlockIdentity,
      blockSelectionReconcilePlugin,
      columnResizing({ handleWidth: 6, cellMinWidth: 80, defaultCellMinWidth: 120 }),
      keymap({
        Tab: goToNextCell(1),
        "Shift-Tab": goToNextCell(-1),
        "Mod-z": undo,
        "Mod-Shift-z": redo,
        "Mod-y": redo,
      }),
      keymap(baseKeymap),
      tableEditing(),
    ],
  })

export type CompositeSnapshotV1 = {
  readonly schemaVersion: 1
  readonly title: string
  readonly caption: string
  readonly code: string
}

export type CompositeSnapshot = {
  readonly schemaVersion: 2
  readonly document: Readonly<Record<string, unknown>>
  readonly code: string
}

export type CompositeMigration = {
  readonly snapshot: CompositeSnapshot
  readonly historyReset: true
}

const paragraph = (text: string) => ({
  type: "paragraph",
  attrs: {
    id: "",
    locked: false,
    snapshotAttrs: {},
    blockExtras: {},
    snapshotType: "paragraph",
  },
  content: text.length === 0 ? [] : [{ type: "text", text }],
})

const documentJson = (title: string, caption: string): Readonly<Record<string, unknown>> => ({
  type: "doc",
  attrs: { documentExtras: { profile: "composite-v2" } },
  content: [
    {
      type: "heading",
      attrs: {
        id: "composite-title",
        locked: false,
        snapshotAttrs: {},
        blockExtras: {},
        snapshotType: "heading",
        level: 1,
      },
      content: [{ type: "text", text: title }],
    },
    {
      type: "table",
      attrs: {
        id: "composite-table",
        locked: false,
        snapshotAttrs: {},
        blockExtras: {},
        snapshotType: "table",
      },
      content: [
        {
          type: "table_row",
          content: [
            {
              type: "table_header",
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: [paragraph("항목")],
            },
            {
              type: "table_header",
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: [paragraph("결정")],
            },
          ],
        },
        {
          type: "table_row",
          content: [
            {
              type: "table_cell",
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: [paragraph("숙소 체크인")],
            },
            {
              type: "table_cell",
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: [paragraph("금요일 16:00")],
            },
          ],
        },
      ],
    },
    {
      type: "caption",
      attrs: {
        id: "composite-caption",
        locked: false,
        snapshotAttrs: { refBlockId: "composite-table" },
        blockExtras: {},
        snapshotType: "caption",
        refBlockId: "composite-table",
      },
      content: [{ type: "text", text: caption }],
    },
  ],
})

export const createCompositeSnapshot = (): CompositeSnapshot => ({
  schemaVersion: 2,
  document: documentJson(
    "봄 여행 워크숍",
    "일정 표에서 함께 정한 내용을 여행 준비 데이터와 맞춥니다.",
  ),
  code: "const itinerary = { destination: '제주', nights: 3 }\n\nexport { itinerary }",
})

export const migrateCompositeSnapshot = (
  snapshot: CompositeSnapshotV1 | CompositeSnapshot,
): CompositeMigration => {
  switch (snapshot.schemaVersion) {
    case 1:
      return {
        snapshot: {
          schemaVersion: 2,
          document: documentJson(snapshot.title, snapshot.caption),
          code: snapshot.code,
        },
        historyReset: true,
      }
    case 2:
      return { snapshot, historyReset: true }
  }
}

export type CompositeCommand = Command
